import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PeticionAutenticada } from './seguridad.tipos';

// Exige un token válido y una cuenta activa. Sin token o con token inválido o vencido: 401.
// Cuenta pendiente de aprobación: 403 ACCOUNT_PENDING. Cuenta suspendida: 403 ACCOUNT_SUSPENDED.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const peticion = contexto.switchToHttp().getRequest<PeticionAutenticada>();
    peticion.usuario = await this.authService.usuarioDelToken(peticion.headers.authorization);
    return true;
  }
}
