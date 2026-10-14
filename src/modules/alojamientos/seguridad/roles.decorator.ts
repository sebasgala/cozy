import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RolUsuario, Usuario } from '../entities/usuario.entity';
import { PeticionAutenticada } from './seguridad.tipos';

export const CLAVE_ROLES = 'roles';

// Roles que pueden entrar a la ruta o al controlador. Sin @Roles, basta con haber iniciado sesión.
export const Roles = (...roles: RolUsuario[]) => SetMetadata(CLAVE_ROLES, roles);

// Usuario autenticado de la petición (solo en rutas con JwtAuthGuard).
export const UsuarioActual = createParamDecorator((_: unknown, contexto: ExecutionContext): Usuario => {
  return contexto.switchToHttp().getRequest<PeticionAutenticada>().usuario;
});
