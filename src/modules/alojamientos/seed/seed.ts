import * as bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { Alojamiento } from '../entities/alojamiento.entity';
import { Ciudad } from '../entities/ciudad.entity';
import { DisponibilidadDiaria } from '../entities/disponibilidad-diaria.entity';
import { Habitacion } from '../entities/habitacion.entity';
import { EstadoUsuario, RolUsuario, Usuario } from '../entities/usuario.entity';
import { COSTE_BCRYPT } from '../seguridad/auth.service';

// Seed de datos de prueba. Se puede ejecutar varias veces sin duplicar datos:
//   npm run seed

const DIAS_DISPONIBILIDAD = 60;

interface HabitacionSeed {
  nombre: string;
  tipo: string;
  capacidadAdultos: number;
  capacidadNinos: number;
  precioBase: number;
  mealPlan: string;
  cancellationType: string;
}

interface AlojamientoSeed {
  nombre: string;
  ciudad: string;
  descripcion: string;
  tienePiscina: boolean;
  facilidades: string[];
  habitaciones: HabitacionSeed[];
}

const CIUDADES = [
  { nombre: 'Quito', pais: 'ec' },
  { nombre: 'Guayaquil', pais: 'ec' },
  { nombre: 'Cuenca', pais: 'ec' },
];

const ALOJAMIENTOS: AlojamientoSeed[] = [
  {
    nombre: 'Cozy Boutique Quito',
    ciudad: 'Quito',
    descripcion: 'Hotel boutique en el centro histórico, con vista a las cúpulas de la ciudad.',
    tienePiscina: false,
    facilidades: ['wifi', 'desayuno', 'recepcion_24h'],
    habitaciones: [
      { nombre: 'Doble Estándar', tipo: 'doble', capacidadAdultos: 2, capacidadNinos: 1, precioBase: 55, mealPlan: 'breakfast_included', cancellationType: 'free_cancellation' },
      { nombre: 'Suite Junior', tipo: 'suite', capacidadAdultos: 2, capacidadNinos: 2, precioBase: 95, mealPlan: 'breakfast_included', cancellationType: 'free_cancellation' },
    ],
  },
  {
    nombre: 'Mirador Andino',
    ciudad: 'Quito',
    descripcion: 'Alojamiento tranquilo en el norte de la ciudad, cerca del parque La Carolina.',
    tienePiscina: true,
    facilidades: ['wifi', 'piscina', 'parqueadero', 'gimnasio'],
    habitaciones: [
      { nombre: 'Individual', tipo: 'individual', capacidadAdultos: 1, capacidadNinos: 0, precioBase: 40, mealPlan: 'room_only', cancellationType: 'non_refundable' },
      { nombre: 'Doble Superior', tipo: 'doble', capacidadAdultos: 2, capacidadNinos: 1, precioBase: 70, mealPlan: 'breakfast_included', cancellationType: 'free_cancellation' },
      { nombre: 'Familiar', tipo: 'familiar', capacidadAdultos: 4, capacidadNinos: 2, precioBase: 120, mealPlan: 'breakfast_included', cancellationType: 'free_cancellation' },
    ],
  },
  {
    nombre: 'Cozy Malecón Suites',
    ciudad: 'Guayaquil',
    descripcion: 'Suites frente al malecón del río Guayas, ideales para viajes de negocios.',
    tienePiscina: true,
    facilidades: ['wifi', 'piscina', 'aire_acondicionado', 'sala_reuniones'],
    habitaciones: [
      { nombre: 'Doble Estándar', tipo: 'doble', capacidadAdultos: 2, capacidadNinos: 1, precioBase: 65, mealPlan: 'room_only', cancellationType: 'free_cancellation' },
      { nombre: 'Suite Ejecutiva', tipo: 'suite', capacidadAdultos: 2, capacidadNinos: 0, precioBase: 110, mealPlan: 'breakfast_included', cancellationType: 'free_cancellation' },
    ],
  },
  {
    nombre: 'Resort Río Guayas',
    ciudad: 'Guayaquil',
    descripcion: 'Resort familiar con piscinas, restaurante y actividades para niños.',
    tienePiscina: true,
    facilidades: ['wifi', 'piscina', 'restaurante', 'club_infantil', 'spa'],
    habitaciones: [
      { nombre: 'Doble Vista Jardín', tipo: 'doble', capacidadAdultos: 2, capacidadNinos: 2, precioBase: 85, mealPlan: 'all_inclusive', cancellationType: 'non_refundable' },
      { nombre: 'Familiar Deluxe', tipo: 'familiar', capacidadAdultos: 4, capacidadNinos: 3, precioBase: 150, mealPlan: 'all_inclusive', cancellationType: 'free_cancellation' },
      { nombre: 'Suite Presidencial', tipo: 'suite', capacidadAdultos: 3, capacidadNinos: 1, precioBase: 220, mealPlan: 'all_inclusive', cancellationType: 'free_cancellation' },
    ],
  },
  {
    nombre: 'Casa Colonial Cuenca',
    ciudad: 'Cuenca',
    descripcion: 'Casa patrimonial restaurada a pocas cuadras de la catedral y el río Tomebamba.',
    tienePiscina: false,
    facilidades: ['wifi', 'desayuno', 'jardin', 'chimenea'],
    habitaciones: [
      { nombre: 'Doble con Balcón', tipo: 'doble', capacidadAdultos: 2, capacidadNinos: 1, precioBase: 60, mealPlan: 'breakfast_included', cancellationType: 'free_cancellation' },
      { nombre: 'Suite Colonial', tipo: 'suite', capacidadAdultos: 2, capacidadNinos: 2, precioBase: 100, mealPlan: 'breakfast_included', cancellationType: 'non_refundable' },
    ],
  },
];

function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Próximos N días como 'YYYY-MM-DD', empezando hoy
function proximosDias(cantidad: number): { fecha: string; finDeSemana: boolean }[] {
  const hoy = new Date();
  const base = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Array.from({ length: cantidad }, (_, i) => {
    const d = new Date(base + i * 24 * 60 * 60 * 1000);
    const dia = d.getUTCDay(); // 5 = viernes, 6 = sábado
    return { fecha: d.toISOString().slice(0, 10), finDeSemana: dia === 5 || dia === 6 };
  });
}

// El superadmin inicial sale de variables de entorno: nunca hay credenciales fijas en el código.
function credencialesSuperadmin(): { email: string; password: string } {
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;
  const faltan = [!email && 'SUPERADMIN_EMAIL', !password && 'SUPERADMIN_PASSWORD'].filter(Boolean);
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno para crear el superadmin: ${faltan.join(', ')}. Defínelas en .env (ver .env.example) y vuelve a correr el seed.`);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('SUPERADMIN_EMAIL no tiene formato de correo');
  if (password.length < 8 || password.length > 72) throw new Error('SUPERADMIN_PASSWORD debe tener entre 8 y 72 caracteres');
  return { email, password };
}

async function seed() {
  const credenciales = credencialesSuperadmin(); // falla antes de tocar la base si faltan
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dataSource = app.get(DataSource);

  const ciudadesRepo = dataSource.getRepository(Ciudad);
  const alojamientosRepo = dataSource.getRepository(Alojamiento);
  const habitacionesRepo = dataSource.getRepository(Habitacion);

  // 0. Superadmin inicial (si ya existe no se toca: la contraseña no se pisa al repetir el seed)
  const usuariosRepo = dataSource.getRepository(Usuario);
  let superadmin = await usuariosRepo.findOneBy({ email: credenciales.email });
  if (!superadmin) {
    superadmin = await usuariosRepo.save(
      usuariosRepo.create({
        email: credenciales.email,
        passwordHash: await bcrypt.hash(credenciales.password, COSTE_BCRYPT),
        nombre: 'Super',
        apellido: 'Admin',
        rol: RolUsuario.SUPERADMIN,
        estado: EstadoUsuario.ACTIVO,
      }),
    );
  } else if (superadmin.rol !== RolUsuario.SUPERADMIN) {
    throw new Error(`${credenciales.email} ya existe con rol ${superadmin.rol}: usa otro SUPERADMIN_EMAIL`);
  }

  // 1. Ciudades
  const ciudades = new Map<string, Ciudad>();
  for (const c of CIUDADES) {
    let ciudad = await ciudadesRepo.findOneBy({ nombre: c.nombre, pais: c.pais });
    if (!ciudad) ciudad = await ciudadesRepo.save(ciudadesRepo.create(c));
    ciudades.set(c.nombre, ciudad);
  }

  // 2. Alojamientos y 3. Habitaciones
  const todasLasHabitaciones: Habitacion[] = [];
  for (const a of ALOJAMIENTOS) {
    const ciudad = ciudades.get(a.ciudad);
    let alojamiento = await alojamientosRepo.findOneBy({ nombre: a.nombre });
    if (!alojamiento) {
      alojamiento = await alojamientosRepo.save(
        alojamientosRepo.create({
          nombre: a.nombre,
          destino: a.ciudad,
          precioPorNoche: Math.min(...a.habitaciones.map((h) => h.precioBase)),
          capacidadAdultos: Math.max(...a.habitaciones.map((h) => h.capacidadAdultos)),
          capacidadNinos: Math.max(...a.habitaciones.map((h) => h.capacidadNinos)),
          habitaciones: a.habitaciones.length,
          tienePiscina: a.tienePiscina,
          descripcion: a.descripcion,
          moneda: 'USD',
          ciudadId: ciudad.id,
          fotos: [1, 2, 3].map((n) => `https://picsum.photos/seed/${slug(a.nombre)}-${n}/800/600`),
          facilidades: a.facilidades,
          politicas: { checkin: '15:00', checkout: '12:00', mascotas: false },
          activo: true,
          propietarioId: superadmin.id,
        }),
      );
    } else if (!alojamiento.propietarioId) {
      // Alojamiento de prueba que ya existía antes de las cuentas: pasa a ser del superadmin.
      alojamiento.propietarioId = superadmin.id;
      await alojamientosRepo.save(alojamiento);
    }

    for (const h of a.habitaciones) {
      let habitacion = await habitacionesRepo.findOneBy({ alojamientoId: alojamiento.id, nombre: h.nombre });
      if (!habitacion) {
        habitacion = await habitacionesRepo.save(habitacionesRepo.create({ ...h, alojamientoId: alojamiento.id }));
      }
      todasLasHabitaciones.push(habitacion);
    }
  }

  // 4. Disponibilidad diaria. ON CONFLICT DO NOTHING: no pisa los días ya existentes.
  const dias = proximosDias(DIAS_DISPONIBILIDAD);
  const filas = todasLasHabitaciones.flatMap((habitacion, indiceHab) =>
    dias.map((dia, indiceDia) => {
      const cupos = 2 + ((indiceDia + indiceHab * 3) % 6); // entre 2 y 7
      return {
        habitacionId: habitacion.id,
        fecha: dia.fecha,
        cupos,
        cuposTotales: cupos, // sin reservas todavía: quedan todos
        precio: Math.round(habitacion.precioBase * (dia.finDeSemana ? 1.15 : 1) * 100) / 100,
      };
    }),
  );
  await dataSource
    .createQueryBuilder()
    .insert()
    .into(DisponibilidadDiaria)
    .values(filas)
    .orIgnore()
    .execute();

  // Resumen
  const conteo = async (tabla: string) =>
    Number((await dataSource.query(`SELECT COUNT(*) AS n FROM ${tabla}`))[0].n);
  console.log('Seed completado. Filas por tabla:');
  for (const tabla of ['ciudades', 'alojamientos', 'habitaciones', 'disponibilidad_diaria']) {
    console.log(`  ${tabla}: ${await conteo(tabla)}`);
  }

  await app.close();
}

seed().catch((error) => {
  console.error('Error en el seed:', error);
  process.exit(1);
});
