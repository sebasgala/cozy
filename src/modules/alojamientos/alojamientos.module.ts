import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AlojamientosService } from './alojamientos.service';
import { AlojamientosController } from './alojamientos.controller';
import { AlojamientosAdminService } from './admin/alojamientos-admin.service';
import { AlojamientosAdminController } from './admin/alojamientos-admin.controller';
import { CiudadesService } from './admin/ciudades.service';
import { CiudadesController } from './admin/ciudades.controller';
import { AccesoAdminService } from './admin/acceso-admin.service';
import { HabitacionesAdminService } from './admin/habitaciones-admin.service';
import { HabitacionesAdminController } from './admin/habitaciones-admin.controller';
import { DisponibilidadAdminService } from './admin/disponibilidad-admin.service';
import { DisponibilidadAdminController } from './admin/disponibilidad-admin.controller';
import { DisponibilidadService } from './disponibilidad.service';
import { OrdenesService } from './ordenes.service';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './seguridad/auth.controller';
import { AuthService, SEGUNDOS_DE_VIGENCIA } from './seguridad/auth.service';
import { AuditoriaService } from './seguridad/auditoria.service';
import { CuentaController } from './seguridad/cuenta.controller';
import { JwtAuthGuard } from './seguridad/jwt-auth.guard';
import { RolesGuard } from './seguridad/roles.guard';
import { LimiteIntentosGuard, LimiteIntentosPorIpGuard } from './seguridad/limite-intentos.guard';
import { UsuariosAdminService } from './admin/usuarios-admin.service';
import { UsuariosAdminController } from './admin/usuarios-admin.controller';
import { ReservasAdminController } from './admin/reservas-admin.controller';
import { Usuario } from './entities/usuario.entity';
import { AuditoriaCambio } from './entities/auditoria-cambio.entity';
import { Alojamiento } from './entities/alojamiento.entity';
import { Ciudad } from './entities/ciudad.entity';
import { Habitacion } from './entities/habitacion.entity';
import { DisponibilidadDiaria } from './entities/disponibilidad-diaria.entity';
import { OrdenPreview } from './entities/orden-preview.entity';
import { Orden } from './entities/orden.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { CommonModule } from '../../common/common.module';
import { ErroresBaseDatosFilter } from './problems/errores-base-datos.filter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Alojamiento,
      Ciudad,
      Habitacion,
      DisponibilidadDiaria,
      OrdenPreview,
      Orden,
      IdempotencyKey,
      Usuario,
      AuditoriaCambio,
    ]),
    // El secreto sale de JWT_SECRET y es obligatorio: sin él la aplicación no arranca (nunca hay uno por defecto).
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET')?.trim();
        if (!secret || secret.length < 32) {
          throw new Error('Falta JWT_SECRET (mínimo 32 caracteres). Genera uno con: node -e "console.log(require(\x27crypto\x27).randomBytes(48).toString(\x27hex\x27))"');
        }
        return { secret, signOptions: { expiresIn: SEGUNDOS_DE_VIGENCIA } };
      },
    }),
    // Límites por defecto de las rutas que usan LimiteIntentosGuard (cada ruta fija el suyo con @Throttle).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
    CommonModule,
  ],
  // AlojamientosController = rutas del contrato; los de admin/ = administración interna (/api/v1/admin)
  controllers: [
    AlojamientosController,
    AlojamientosAdminController,
    CiudadesController,
    HabitacionesAdminController,
    DisponibilidadAdminController,
    UsuariosAdminController,
    ReservasAdminController,
    AuthController,
    CuentaController,
  ],
  providers: [
    AlojamientosService,
    AlojamientosAdminService,
    CiudadesService,
    DisponibilidadService,
    OrdenesService,
    AccesoAdminService,
    HabitacionesAdminService,
    DisponibilidadAdminService,
    UsuariosAdminService,
    AuthService,
    AuditoriaService,
    JwtAuthGuard,
    RolesGuard,
    LimiteIntentosGuard,
    LimiteIntentosPorIpGuard,
    // Global: restricciones de PostgreSQL (check, foreign key, unique) => 400/409 problem+json, nunca 500.
    { provide: APP_FILTER, useClass: ErroresBaseDatosFilter },
  ],
})
export class AlojamientosModule {}
