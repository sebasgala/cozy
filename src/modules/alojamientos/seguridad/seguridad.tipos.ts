import { Request } from 'express';
import { Usuario } from '../entities/usuario.entity';

// Petición ya autenticada: JwtAuthGuard deja aquí al usuario (leído de la base en cada petición, así un
// cambio de rol, una suspensión o una aprobación se nota de inmediato, sin esperar a que venza el token).
export interface PeticionAutenticada extends Request {
  usuario: Usuario;
}

// Contenido del JWT. Solo el id: el rol y el estado se leen de la base.
export interface CargaJwt {
  sub: string;
}
