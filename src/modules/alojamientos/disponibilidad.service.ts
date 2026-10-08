import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Alojamiento } from './entities/alojamiento.entity';
import { DisponibilidadDiaria } from './entities/disponibilidad-diaria.entity';
import { Habitacion } from './entities/habitacion.entity';
import { RecursoNoEncontradoException } from './problems/problem-details.exceptions';
import { acotarEntero, esIdPosible } from './alojamientos-consulta.utils';

export interface RepartoHuespedes {
  habitaciones: number;
  adultosPorHabitacion: number;
  ninosPorHabitacion: number;
}

export interface CriterioDisponibilidad {
  alojamientoId: number;
  habitacionId?: string; // para limitar el cálculo a una sola habitación
  checkin: string;
  checkout: string;
  noches: number;
  reparto: RepartoHuespedes;
}

export interface HabitacionDisponible {
  id: string;
  nombre: string;
  tipo: string;
  mealPlan: string | null;
  cancellationType: string | null;
  capacidadAdultos: number;
  capacidadNinos: number;
  total: number; // por habitación y por toda la estancia: suma de las noches
  cuposMinimos: number;
  noches: { date: string; price: number }[];
}

// Fuente única del cálculo de precio y disponibilidad: la usan /availability (paso 5)
// y las órdenes (preview y create, paso 6). Recibe un EntityManager cuando debe correr
// dentro de una transacción.
@Injectable()
export class DisponibilidadService {
  constructor(
    @InjectRepository(Alojamiento)
    private readonly alojamientosRepository: Repository<Alojamiento>,
    @InjectRepository(Habitacion)
    private readonly habitacionesRepository: Repository<Habitacion>,
  ) {}

  // Un alojamiento inactivo cuenta como inexistente para las rutas del contrato.
  async buscarAlojamientoActivo(id: number, parametro: string): Promise<Alojamiento> {
    const alojamiento = esIdPosible(id)
      ? await this.alojamientosRepository.findOneBy({ id: acotarEntero(id), activo: true })
      : null;
    if (!alojamiento) {
      const reason = `El alojamiento ${id} no existe o está inactivo`;
      throw new RecursoNoEncontradoException(reason, [{ name: parametro, reason }]);
    }
    return alojamiento;
  }

  // Habitaciones libres TODAS las noches de [checkin, checkout), con cupos >= habitaciones pedidas
  // y donde caben los huéspedes. El total es la suma del precio de cada noche. Una sola consulta.
  async habitacionesDisponibles(criterio: CriterioDisponibilidad, manager?: EntityManager): Promise<HabitacionDisponible[]> {
    const repositorio = manager ? manager.getRepository(Habitacion) : this.habitacionesRepository;
    const consulta = repositorio
      .createQueryBuilder('h')
      .innerJoin(DisponibilidadDiaria, 'd', 'd.habitacionId = h.id')
      .select('h.id', 'id')
      .addSelect('h.nombre', 'nombre')
      .addSelect('h.tipo', 'tipo')
      .addSelect('h.mealPlan', 'mealPlan')
      .addSelect('h.cancellationType', 'cancellationType')
      .addSelect('h.capacidadAdultos', 'capacidadAdultos')
      .addSelect('h.capacidadNinos', 'capacidadNinos')
      .addSelect('SUM(d.precio)', 'total')
      .addSelect('MIN(d.cupos)', 'cuposMinimos')
      .addSelect("json_agg(json_build_object('date', d.fecha, 'price', d.precio) ORDER BY d.fecha)", 'desglose')
      .where('h.alojamientoId = :alojamiento', { alojamiento: criterio.alojamientoId })
      .andWhere('h.capacidadAdultos >= :adultos', { adultos: criterio.reparto.adultosPorHabitacion })
      .andWhere('h.capacidadNinos >= :ninos', { ninos: criterio.reparto.ninosPorHabitacion })
      .andWhere('d.fecha >= :checkin AND d.fecha < :checkout', { checkin: criterio.checkin, checkout: criterio.checkout })
      .andWhere('d.cupos >= :habitaciones', { habitaciones: criterio.reparto.habitaciones })
      .groupBy('h.id')
      .having('COUNT(*) = :noches', { noches: criterio.noches });
    if (criterio.habitacionId) consulta.andWhere('h.id = :habitacionId', { habitacionId: criterio.habitacionId });

    const filas = await consulta.getRawMany<{
      id: string;
      nombre: string;
      tipo: string;
      mealPlan: string | null;
      cancellationType: string | null;
      capacidadAdultos: number;
      capacidadNinos: number;
      total: string;
      cuposMinimos: number;
      desglose: { date: string; price: number }[];
    }>();

    return filas
      .map((fila) => ({
        id: fila.id,
        nombre: fila.nombre,
        tipo: fila.tipo,
        mealPlan: fila.mealPlan,
        cancellationType: fila.cancellationType,
        capacidadAdultos: Number(fila.capacidadAdultos),
        capacidadNinos: Number(fila.capacidadNinos),
        total: Number(fila.total),
        cuposMinimos: Number(fila.cuposMinimos),
        noches: fila.desglose,
      }))
      .sort((a, b) => a.total - b.total || a.nombre.localeCompare(b.nombre));
  }

  // Bloqueo pesimista de escritura (SELECT ... FOR UPDATE) de las noches de una habitación.
  // Se bloquean en orden de fecha para que dos transacciones no se crucen (deadlock).
  bloquearNoches(manager: EntityManager, habitacionId: string, checkin: string, checkout: string): Promise<DisponibilidadDiaria[]> {
    return manager
      .getRepository(DisponibilidadDiaria)
      .createQueryBuilder('d')
      .setLock('pessimistic_write')
      .where('d.habitacionId = :habitacionId', { habitacionId })
      .andWhere('d.fecha >= :checkin AND d.fecha < :checkout', { checkin, checkout })
      .orderBy('d.fecha', 'ASC')
      .getMany();
  }

  // Resta `cantidad` cupos a cada noche. Solo toca filas con cupos suficientes y exige que sean todas.
  async descontarCupos(manager: EntityManager, habitacionId: string, checkin: string, checkout: string, cantidad: number, noches: number) {
    const resultado = await manager
      .createQueryBuilder()
      .update(DisponibilidadDiaria)
      .set({ cupos: () => `cupos - ${this.entero(cantidad)}` })
      .where('habitacionId = :habitacionId', { habitacionId })
      .andWhere('fecha >= :checkin AND fecha < :checkout', { checkin, checkout })
      .andWhere('cupos >= :cantidad', { cantidad })
      .execute();
    if (resultado.affected !== noches) {
      // No debería pasar con las filas bloqueadas; si pasa, la transacción se deshace entera.
      throw new Error(`Se esperaban ${noches} noches con cupos y se actualizaron ${resultado.affected}`);
    }
  }

  // Devuelve `cantidad` cupos a cada noche (cancelación).
  async devolverCupos(manager: EntityManager, habitacionId: string, checkin: string, checkout: string, cantidad: number) {
    await manager
      .createQueryBuilder()
      .update(DisponibilidadDiaria)
      .set({ cupos: () => `cupos + ${this.entero(cantidad)}` })
      .where('habitacionId = :habitacionId', { habitacionId })
      .andWhere('fecha >= :checkin AND fecha < :checkout', { checkin, checkout })
      .execute();
  }

  // El valor va dentro del SQL: se asegura que sea un entero positivo.
  private entero(valor: number): number {
    if (!Number.isInteger(valor) || valor < 1) throw new Error(`Cantidad de cupos inválida: ${valor}`);
    return valor;
  }
}
