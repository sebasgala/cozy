import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Habitacion } from '../entities/habitacion.entity';
import {
  ActualizarHabitacionDto,
  CrearHabitacionDto,
  FiltroHabitacionesQueryDto,
  HabitacionAdminResponseDto,
} from '../dto/admin/habitacion-admin.dto';
import { ConsultaInvalidaException } from '../problems/problem-details.exceptions';
import { AccesoAdminService } from './acceso-admin.service';

// En PATCH estos campos no pueden venir en null (las columnas son NOT NULL).
const CAMPOS_NO_NULOS: (keyof ActualizarHabitacionDto)[] = ['nombre', 'tipo', 'capacidadAdultos', 'capacidadNinos', 'precioBase'];

// CRUD interno de habitaciones. Nunca borra filas: desactivar es borrado lógico (activo = false), y no toca
// órdenes ni disponibilidad. Crear una habitación no crea disponibilidad.
@Injectable()
export class HabitacionesAdminService {
  constructor(
    @InjectRepository(Habitacion)
    private readonly habitacionesRepository: Repository<Habitacion>,
    private readonly acceso: AccesoAdminService,
  ) {}

  async listar(alojamientoId: number, filtro: FiltroHabitacionesQueryDto): Promise<HabitacionAdminResponseDto[]> {
    const alojamiento = await this.acceso.alojamiento(alojamientoId);
    const where: FindOptionsWhere<Habitacion> = { alojamientoId: alojamiento.id };
    if (!filtro.incluirInactivas) where.activo = true;
    const habitaciones = await this.habitacionesRepository.find({ where, order: { nombre: 'ASC' } });
    return habitaciones.map((h) => this.aRespuesta(h));
  }

  async crear(alojamientoId: number, dto: CrearHabitacionDto): Promise<HabitacionAdminResponseDto> {
    const alojamiento = await this.acceso.alojamiento(alojamientoId);
    const nueva = await this.habitacionesRepository.save(
      this.habitacionesRepository.create({
        alojamientoId: alojamiento.id,
        nombre: dto.nombre,
        tipo: dto.tipo,
        capacidadAdultos: dto.capacidadAdultos,
        capacidadNinos: dto.capacidadNinos,
        precioBase: dto.precioBase,
        mealPlan: dto.mealPlan ?? null,
        cancellationType: dto.cancellationType ?? null,
        activo: true,
      }),
    );
    return this.aRespuesta(nueva);
  }

  async obtener(id: string): Promise<HabitacionAdminResponseDto> {
    return this.aRespuesta(await this.acceso.habitacion(id));
  }

  async actualizar(id: string, dto: ActualizarHabitacionDto): Promise<HabitacionAdminResponseDto> {
    const habitacion = await this.acceso.habitacion(id);
    const nulos = CAMPOS_NO_NULOS.filter((campo) => dto[campo] === null);
    if (nulos.length > 0) {
      throw new ConsultaInvalidaException(nulos.map((campo) => ({ name: campo, reason: 'no puede ser null' })));
    }
    const enviados = Object.fromEntries(Object.entries(dto).filter(([, valor]) => valor !== undefined));
    Object.assign(habitacion, enviados);
    return this.aRespuesta(await this.habitacionesRepository.save(habitacion));
  }

  // Desactivar y reactivar son idempotentes: repetirlos no da error.
  async cambiarEstado(id: string, activo: boolean): Promise<HabitacionAdminResponseDto> {
    const habitacion = await this.acceso.habitacion(id);
    if (habitacion.activo !== activo) {
      await this.habitacionesRepository.update({ id: habitacion.id }, { activo });
      habitacion.activo = activo;
    }
    return this.aRespuesta(habitacion);
  }

  private aRespuesta(h: Habitacion): HabitacionAdminResponseDto {
    const base = `/api/v1/admin/habitaciones/${h.id}`;
    return {
      id: h.id,
      alojamientoId: h.alojamientoId,
      nombre: h.nombre,
      tipo: h.tipo,
      capacidadAdultos: h.capacidadAdultos,
      capacidadNinos: h.capacidadNinos,
      precioBase: h.precioBase,
      mealPlan: h.mealPlan,
      cancellationType: h.cancellationType,
      activo: h.activo,
      _links: {
        self: base,
        alojamiento: `/api/v1/admin/alojamientos/${h.alojamientoId}`,
        disponibilidad: `${base}/disponibilidad`,
        [h.activo ? 'desactivar' : 'reactivar']: `${base}/${h.activo ? 'desactivar' : 'reactivar'}`,
      },
    };
  }
}
