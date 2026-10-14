import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { LoginDto, LoginResponseDto, RegistroDto, UsuarioResponseDto } from '../dto/auth/auth.dto';
import { EstadoUsuario, RolUsuario, Usuario } from '../entities/usuario.entity';
import {
  ConflictoException,
  NoAutenticadoException,
  ProhibidoException,
} from '../problems/problem-details.exceptions';
import { CargaJwt } from './seguridad.tipos';

export const COSTE_BCRYPT = 12;
export const SEGUNDOS_DE_VIGENCIA = 60 * 60;

@Injectable()
export class AuthService {
  // Hash de relleno: si el correo no existe, igual se compara contra algo para que responder tarde lo mismo
  // y no se pueda averiguar qué correos tienen cuenta midiendo el tiempo.
  private hashDeRelleno?: Promise<string>;

  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    private readonly jwtService: JwtService,
  ) {}

  // ───────────────────────── Registro y login ─────────────────────────

  // cliente => activo. administrador => pendiente hasta que el superadmin lo apruebe. Nunca superadmin.
  async registrar(dto: RegistroDto): Promise<UsuarioResponseDto> {
    const email = this.normalizarCorreo(dto.email);
    const rol = dto.rol ?? RolUsuario.CLIENTE;
    if (await this.usuariosRepository.existsBy({ email })) {
      throw new ConflictoException('VALIDATION_FAILED', 'Ya existe una cuenta con ese correo', [
        { name: 'email', reason: 'ya está registrado' },
      ]);
    }
    const usuario = await this.usuariosRepository.save(
      this.usuariosRepository.create({
        email,
        passwordHash: await bcrypt.hash(dto.password, COSTE_BCRYPT),
        nombre: dto.nombre.trim(),
        apellido: dto.apellido.trim(),
        rol,
        estado: rol === RolUsuario.ADMINISTRADOR ? EstadoUsuario.PENDIENTE : EstadoUsuario.ACTIVO,
      }),
    );
    return this.aRespuesta(usuario);
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const usuario = await this.usuariosRepository.findOneBy({ email: this.normalizarCorreo(dto.email) });
    const hash = usuario?.passwordHash ?? (await this.relleno());
    const correcta = await bcrypt.compare(dto.password, hash);
    // Mismo mensaje para "no existe" y "contraseña incorrecta".
    if (!usuario || !correcta) throw new NoAutenticadoException('Correo o contraseña incorrectos');

    // El estado solo se revela a quien conoce la contraseña.
    this.exigirCuentaActiva(usuario);
    const access_token = await this.jwtService.signAsync({ sub: usuario.id } satisfies CargaJwt);
    return { access_token, token_type: 'Bearer', expires_in: SEGUNDOS_DE_VIGENCIA, usuario: this.aRespuesta(usuario) };
  }

  // ───────────────────────── Token ─────────────────────────

  // Usuario de la cabecera Authorization, para JwtAuthGuard. Cualquier fallo es 401.
  async usuarioDelToken(cabecera: string | undefined): Promise<Usuario> {
    const token = this.extraerToken(cabecera);
    if (!token) throw new NoAutenticadoException();
    let carga: CargaJwt;
    try {
      carga = await this.jwtService.verifyAsync<CargaJwt>(token);
    } catch {
      throw new NoAutenticadoException('El token no es válido o venció: inicia sesión de nuevo');
    }
    const usuario = typeof carga?.sub === 'string' ? await this.buscarPorId(carga.sub) : null;
    if (!usuario) throw new NoAutenticadoException('El token no es válido o venció: inicia sesión de nuevo');
    this.exigirCuentaActiva(usuario);
    return usuario;
  }

  // Para las rutas del contrato, que no exigen login: si llega un token válido de una cuenta activa se usa
  // para asociar la compra; si no hay token, o no sirve, la petición sigue como compra sin cuenta.
  async usuarioOpcional(cabecera: string | undefined): Promise<Usuario | null> {
    if (!this.extraerToken(cabecera)) return null;
    try {
      return await this.usuarioDelToken(cabecera);
    } catch {
      return null;
    }
  }

  // ───────────────────────── Apoyo ─────────────────────────

  aRespuesta(u: Usuario): UsuarioResponseDto {
    return {
      id: u.id,
      email: u.email,
      nombre: u.nombre,
      apellido: u.apellido,
      rol: u.rol,
      estado: u.estado,
      createdAt: new Date(u.createdAt).toISOString(),
    };
  }

  private exigirCuentaActiva(usuario: Usuario): void {
    if (usuario.estado === EstadoUsuario.PENDIENTE) {
      throw new ProhibidoException('Tu cuenta de administrador está pendiente de aprobación por el superadmin', 'ACCOUNT_PENDING');
    }
    if (usuario.estado === EstadoUsuario.SUSPENDIDO) {
      throw new ProhibidoException('Tu cuenta está suspendida', 'ACCOUNT_SUSPENDED');
    }
  }

  private buscarPorId(id: string): Promise<Usuario | null> {
    // Un sub que no sea UUID (token manipulado con la firma correcta, imposible hoy) no debe llegar a PostgreSQL.
    return /^[0-9a-f-]{36}$/i.test(id) ? this.usuariosRepository.findOneBy({ id }) : Promise.resolve(null);
  }

  private extraerToken(cabecera: string | undefined): string | null {
    const partes = (cabecera ?? '').trim().split(/\s+/);
    return partes.length === 2 && /^bearer$/i.test(partes[0]) ? partes[1] : null;
  }

  private normalizarCorreo(correo: string): string {
    return correo.trim().toLowerCase();
  }

  private relleno(): Promise<string> {
    this.hashDeRelleno ??= bcrypt.hash('relleno-sin-usuario', COSTE_BCRYPT);
    return this.hashDeRelleno;
  }
}
