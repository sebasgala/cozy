import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AlojamientosService } from './alojamientos.service';
import { AlojamientosController } from './alojamientos.controller';
import { AlojamientosAdminService } from './alojamientos-admin.service';
import { AlojamientosAdminController } from './alojamientos-admin.controller';
import { CiudadesService } from './ciudades.service';
import { DisponibilidadService } from './disponibilidad.service';
import { OrdenesService } from './ordenes.service';
import { CiudadesController } from './ciudades.controller';
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
  // AlojamientosController = rutas del contrato; los "Admin" y Ciudades = CRUD de administración
  controllers: [AlojamientosController, AlojamientosAdminController, CiudadesController],
  providers: [
    AlojamientosService,
    AlojamientosAdminService,
    CiudadesService,
    DisponibilidadService,
    OrdenesService,
    // Global: restricciones de PostgreSQL (check, foreign key, unique) => 400/409 problem+json, nunca 500.
    { provide: APP_FILTER, useClass: ErroresBaseDatosFilter },
  ],
})
export class AlojamientosModule {}
