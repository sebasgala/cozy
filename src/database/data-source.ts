import 'dotenv/config';
import { join } from 'path';
import { DataSource } from 'typeorm';

// Data source para el CLI de TypeORM (migration:generate, migration:run y migration:revert).
// Se usa ya compilado (dist/database/data-source.js): los scripts de package.json hacen `nest build` antes.
// Lee DATABASE_URL del entorno o del archivo .env (dotenv no pisa una variable que ya existe).
//
// Solo entran las entidades de alojamientos: los módulos de autos, atracciones y vuelos no están activos.
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [join(__dirname, '..', 'modules', 'alojamientos', 'entities', '*.entity.{ts,js}')],
  // Solo .js: en dist también hay .d.ts y no son migraciones.
  migrations: [join(__dirname, 'migrations', '*.js')],
  migrationsTableName: 'migraciones',
  synchronize: false,
});
