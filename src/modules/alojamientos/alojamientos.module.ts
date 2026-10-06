import { Module } from '@nestjs/common';
import { AlojamientosService } from './alojamientos.service';
import { AlojamientosController } from './alojamientos.controller';
import { AlojamientosAdminService } from './alojamientos-admin.service';
import { AlojamientosAdminController } from './alojamientos-admin.controller';
import { CiudadesService } from './ciudades.service';
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
  providers: [AlojamientosService, AlojamientosAdminService, CiudadesService],
})
export class AlojamientosModule {}
