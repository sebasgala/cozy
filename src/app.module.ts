import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { CommonModule } from './common/common.module';
import { opcionesConexion } from './database/opciones-conexion';
import { HealthController } from './health/health.controller';
import { AlojamientosModule } from './modules/alojamientos/alojamientos.module';
// import { AutosModule } from './modules/autos/autos.module';
// import { AtraccionesModule } from './modules/atracciones/atracciones.module';
// import { VuelosModule } from './modules/vuelos/vuelos.module';

@Module({
  imports: [
    // Carga de variables de entorno globales
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Configuración centralizada de TypeORM usando DATABASE_URL
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        // DATABASE_URL, o DB_HOST/DB_USER/..., con SSL en producción (ver database/opciones-conexion.ts).
        ...opcionesConexion({
          DATABASE_URL: configService.get<string>('DATABASE_URL'),
          DB_HOST: configService.get<string>('DB_HOST'),
          DB_PORT: configService.get<string>('DB_PORT'),
          DB_USER: configService.get<string>('DB_USER'),
          DB_PASSWORD: configService.get<string>('DB_PASSWORD'),
          DB_NAME: configService.get<string>('DB_NAME'),
          DATABASE_SSL: configService.get<string>('DATABASE_SSL'),
          NODE_ENV: configService.get<string>('NODE_ENV'),
        }),
        autoLoadEntities: true,
        // El esquema lo crean SOLO las migraciones (npm run migration:run), también en desarrollo.
        synchronize: false,
      }),
    }),

    // Módulos Compartidos
    CommonModule,

    // =========================================================================
    // ATENCIÓN ALUMNO: Descomenta solo el módulo que corresponde a tu grupo
    // =========================================================================
    AlojamientosModule,
    // AutosModule,
    // AtraccionesModule,
    // VuelosModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
