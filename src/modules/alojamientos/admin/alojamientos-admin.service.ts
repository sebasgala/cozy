import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Alojamiento } from '../entities/alojamiento.entity';
import { Ciudad } from '../entities/ciudad.entity';
import { Habitacion } from '../entities/habitacion.entity';
import { CreateAlojamientoDto } from '../dto/create-alojamiento.dto';
import { UpdateAlojamientoDto } from '../dto/update-alojamiento.dto';
import { FiltroAlojamientosQueryDto } from '../dto/filtro-alojamientos-query.dto';
import { AlojamientoResponseDto, PaginatedAlojamientosResponseDto } from '../dto/alojamiento-response.dto';
import { ConsultaInvalidaException } from '../problems/problem-details.exceptions';
import { AccesoAdminService } from './acceso-admin.service';

// En PATCH estos campos no pueden venir en null (las columnas son NOT NULL)
const CAMPOS_NO_NULOS: (keyof UpdateAlojamientoDto)[] = [
  'nombre',
  'ciudadId',
  'moneda',
  'precioPorNoche',
  'capacidadAdultos',
  'capacidadNinos',
  'tienePiscina',
  'activo',
];

// Servicio del CRUD de administración (rutas /admin/alojamientos). Es aparte del servicio del contrato.
@Injectable()
export class AlojamientosAdminService {
  constructor(
    @InjectRepository(Alojamiento)
    private readonly alojamientosRepository: Repository<Alojamiento>,
    @InjectRepository(Ciudad)
    private readonly ciudadesRepository: Repository<Ciudad>,
    @InjectRepository(Habitacion)
    private readonly habitacionesRepository: Repository<Habitacion>,
    private readonly acceso: AccesoAdminService,
  ) {}

  async findAll(query: FiltroAlojamientosQueryDto): Promise<PaginatedAlojamientosResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const where: FindOptionsWhere<Alojamiento> = {};
    if (query.ciudadId !== undefined) where.ciudadId = query.ciudadId;
    if (query.activo !== undefined) where.activo = query.activo;

    const [alojamientos, totalItems] = await this.alojamientosRepository.findAndCount({
      where,
      relations: { ciudad: true },
      order: { id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const conteo = await this.contarHabitaciones(alojamientos.map((a) => a.id), query.incluirInactivas);

    const totalPages = Math.ceil(totalItems / limit);
    const ultima = Math.max(totalPages, 1);
    const enlace = (numero: number) => {
      const params = new URLSearchParams({ page: String(numero), limit: String(limit) });
      if (query.ciudadId !== undefined) params.set('ciudadId', String(query.ciudadId));
      if (query.activo !== undefined) params.set('activo', String(query.activo));
      if (query.incluirInactivas !== undefined) params.set('incluirInactivas', String(query.incluirInactivas));
      return `/api/v1/admin/alojamientos?${params.toString()}`;
    };

    return {
      data: alojamientos.map((a) => this.aRespuesta(a, conteo.get(a.id) ?? 0)),
      meta: {
        totalItems,
        itemCount: alojamientos.length,
        itemsPerPage: limit,
        totalPages,
        currentPage: page,
      },
      _links: {
        first: enlace(1),
        ...(page > 1 && { previous: enlace(Math.min(page - 1, ultima)) }),
        ...(page < totalPages && { next: enlace(page + 1) }),
        last: enlace(ultima),
      },
    };
  }

  // Devuelve también los alojamientos dados de baja: el admin puede verlos.
  async findOne(id: number, incluirInactivas = false): Promise<AlojamientoResponseDto> {
    const alojamiento = await this.buscarEntidad(id);
    const conteo = await this.contarHabitaciones([id], incluirInactivas);
    return this.aRespuesta(alojamiento, conteo.get(id) ?? 0);
  }

  async crear(dto: CreateAlojamientoDto): Promise<AlojamientoResponseDto> {
    const ciudad = await this.obtenerCiudad(dto.ciudadId);
    const nuevo = this.alojamientosRepository.create({
      nombre: dto.nombre,
      ciudadId: ciudad.id,
      destino: ciudad.nombre,
      descripcion: dto.descripcion ?? null,
      moneda: dto.moneda ?? 'USD',
      precioPorNoche: dto.precioPorNoche,
      capacidadAdultos: dto.capacidadAdultos,
      capacidadNinos: dto.capacidadNinos,
      habitaciones: 0, // columna de respaldo; el valor real se calcula al responder
      tienePiscina: dto.tienePiscina,
      fotos: dto.fotos ?? null,
      facilidades: dto.facilidades ?? null,
      politicas: dto.politicas ?? null,
      activo: dto.activo ?? true,
    });
    const guardado = await this.alojamientosRepository.save(nuevo);
    return this.findOne(guardado.id);
  }

  // PUT: reemplazo completo. Lo que no se envía vuelve a su valor por defecto,
  // salvo `activo`, que se conserva si no se envía (el estado no es parte del contenido).
  async reemplazar(id: number, dto: CreateAlojamientoDto): Promise<void> {
    const alojamiento = await this.buscarEntidad(id);
    const ciudad = await this.obtenerCiudad(dto.ciudadId);

    Object.assign(alojamiento, {
      nombre: dto.nombre,
      ciudadId: ciudad.id,
      ciudad,
      destino: ciudad.nombre,
      descripcion: dto.descripcion ?? null,
      moneda: dto.moneda ?? 'USD',
      precioPorNoche: dto.precioPorNoche,
      capacidadAdultos: dto.capacidadAdultos,
      capacidadNinos: dto.capacidadNinos,
      tienePiscina: dto.tienePiscina,
      fotos: dto.fotos ?? null,
      facilidades: dto.facilidades ?? null,
      politicas: dto.politicas ?? null,
    });
    if (dto.activo !== undefined && dto.activo !== null) alojamiento.activo = dto.activo;

    await this.alojamientosRepository.save(alojamiento);
  }

  // PATCH: solo cambia los campos enviados.
  async actualizar(id: number, dto: UpdateAlojamientoDto): Promise<AlojamientoResponseDto> {
    const alojamiento = await this.buscarEntidad(id);

    const nulos = CAMPOS_NO_NULOS.filter((campo) => dto[campo] === null);
    if (nulos.length > 0) {
      throw new ConsultaInvalidaException(nulos.map((campo) => ({ name: campo, reason: 'no puede ser null' })));
    }

    const { ciudadId, ...resto } = dto;
    if (ciudadId !== undefined) {
      const ciudad = await this.obtenerCiudad(ciudadId);
      alojamiento.ciudadId = ciudad.id;
      alojamiento.ciudad = ciudad;
      alojamiento.destino = ciudad.nombre;
    }
    const enviados = Object.fromEntries(Object.entries(resto).filter(([, valor]) => valor !== undefined));
    Object.assign(alojamiento, enviados);

    await this.alojamientosRepository.save(alojamiento);
    return this.findOne(id);
  }

  // Borrado lógico: no elimina la fila, solo pone activo = false. Repetirlo no da error.
  async desactivar(id: number): Promise<void> {
    const alojamiento = await this.buscarEntidad(id);
    if (alojamiento.activo) {
      alojamiento.activo = false;
      await this.alojamientosRepository.save(alojamiento);
    }
  }

  // ───────────────────────── Apoyo ─────────────────────────

  // Pasa por el punto único de acceso del admin (paso 8: comprobará el propietario).
  private buscarEntidad(id: number): Promise<Alojamiento> {
    return this.acceso.alojamiento(id);
  }

  private async obtenerCiudad(ciudadId: number): Promise<Ciudad> {
    const ciudad = await this.ciudadesRepository.findOneBy({ id: ciudadId });
    if (!ciudad) throw new ConsultaInvalidaException([{ name: 'ciudadId', reason: `la ciudad ${ciudadId} no existe` }]);
    return ciudad;
  }

  // Cuenta las habitaciones de varios alojamientos con una sola consulta: solo las activas, salvo que se pida.
  private async contarHabitaciones(ids: number[], incluirInactivas = false): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const consulta = this.habitacionesRepository
      .createQueryBuilder('h')
      .select('h.alojamientoId', 'alojamientoId')
      .addSelect('COUNT(*)', 'total')
      .where('h.alojamientoId IN (:...ids)', { ids });
    if (!incluirInactivas) consulta.andWhere('h.activo = true');
    const filas = await consulta
      .groupBy('h.alojamientoId')
      .getRawMany<{ alojamientoId: number; total: string }>();
    return new Map(filas.map((f) => [Number(f.alojamientoId), Number(f.total)]));
  }

  private aRespuesta(a: Alojamiento, habitaciones: number): AlojamientoResponseDto {
    return {
      id: a.id,
      nombre: a.nombre,
      destino: a.destino,
      ciudadId: a.ciudadId,
      ciudad: a.ciudad ? { id: a.ciudad.id, nombre: a.ciudad.nombre, pais: a.ciudad.pais } : null,
      descripcion: a.descripcion,
      moneda: a.moneda,
      precioPorNoche: a.precioPorNoche,
      capacidadAdultos: a.capacidadAdultos,
      capacidadNinos: a.capacidadNinos,
      habitaciones,
      tienePiscina: a.tienePiscina,
      fotos: a.fotos,
      facilidades: a.facilidades,
      politicas: a.politicas,
      activo: a.activo,
      updatedAt: a.updatedAt,
      _links: { self: `/api/v1/admin/alojamientos/${a.id}`, habitaciones: `/api/v1/admin/alojamientos/${a.id}/habitaciones` },
    };
  }
}
