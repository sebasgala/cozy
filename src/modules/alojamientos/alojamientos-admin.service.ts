import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Alojamiento } from './entities/alojamiento.entity';
import { Ciudad } from './entities/ciudad.entity';
import { Habitacion } from './entities/habitacion.entity';
import { CreateAlojamientoDto } from './dto/create-alojamiento.dto';
import { UpdateAlojamientoDto } from './dto/update-alojamiento.dto';
import { FiltroAlojamientosQueryDto } from './dto/filtro-alojamientos-query.dto';
import { AlojamientoResponseDto, PaginatedAlojamientosResponseDto } from './dto/alojamiento-response.dto';

// Mayor valor que cabe en una columna integer de PostgreSQL
const ID_MAXIMO = 2147483647;

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

// Servicio del CRUD de administración (rutas /alojamientos). Es aparte del servicio del contrato.
@Injectable()
export class AlojamientosAdminService {
  constructor(
    @InjectRepository(Alojamiento)
    private readonly alojamientosRepository: Repository<Alojamiento>,
    @InjectRepository(Ciudad)
    private readonly ciudadesRepository: Repository<Ciudad>,
    @InjectRepository(Habitacion)
    private readonly habitacionesRepository: Repository<Habitacion>,
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
    const conteo = await this.contarHabitaciones(alojamientos.map((a) => a.id));

    const totalPages = Math.ceil(totalItems / limit);
    const ultima = Math.max(totalPages, 1);
    const enlace = (numero: number) => {
      const params = new URLSearchParams({ page: String(numero), limit: String(limit) });
      if (query.ciudadId !== undefined) params.set('ciudadId', String(query.ciudadId));
      if (query.activo !== undefined) params.set('activo', String(query.activo));
      return `/api/v1/alojamientos?${params.toString()}`;
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
  async findOne(id: number): Promise<AlojamientoResponseDto> {
    const alojamiento = await this.buscarEntidad(id);
    const conteo = await this.contarHabitaciones([id]);
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

    for (const campo of CAMPOS_NO_NULOS) {
      if (dto[campo] === null) {
        throw new BadRequestException(`El campo "${campo}" no puede ser null`);
      }
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

  private async buscarEntidad(id: number): Promise<Alojamiento> {
    // Un id fuera del rango de integer haría fallar a PostgreSQL (500); no puede existir.
    const alojamiento =
      id >= 1 && id <= ID_MAXIMO
        ? await this.alojamientosRepository.findOne({ where: { id }, relations: { ciudad: true } })
        : null;
    if (!alojamiento) throw new NotFoundException(`Alojamiento ${id} no existe`);
    return alojamiento;
  }

  private async obtenerCiudad(ciudadId: number): Promise<Ciudad> {
    const ciudad = await this.ciudadesRepository.findOneBy({ id: ciudadId });
    if (!ciudad) throw new BadRequestException(`La ciudad ${ciudadId} no existe`);
    return ciudad;
  }

  // Cuenta las filas de la tabla habitaciones de varios alojamientos con una sola consulta.
  private async contarHabitaciones(ids: number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const filas = await this.habitacionesRepository
      .createQueryBuilder('h')
      .select('h.alojamientoId', 'alojamientoId')
      .addSelect('COUNT(*)', 'total')
      .where('h.alojamientoId IN (:...ids)', { ids })
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
      _links: { self: `/api/v1/alojamientos/${a.id}` },
    };
  }
}
