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
import { TypeOrmModule } from '@nestjs/typeorm';
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
    ]),
    CommonModule,
  ],
  // AlojamientosController = rutas del contrato; los de admin/ = administración interna (/api/v1/admin)
  controllers: [
    AlojamientosController,
    AlojamientosAdminController,
    CiudadesController,
    HabitacionesAdminController,
    DisponibilidadAdminController,
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
    // Global: restricciones de PostgreSQL (check, foreign key, unique) => 400/409 problem+json, nunca 500.
    { provide: APP_FILTER, useClass: ErroresBaseDatosFilter },
  ],
})
export class AlojamientosModule {}
