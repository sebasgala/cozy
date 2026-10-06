import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Any, FindOptionsWhere, Repository } from 'typeorm';
import { Alojamiento } from './entities/alojamiento.entity';
import { DisponibilidadDiaria } from './entities/disponibilidad-diaria.entity';
import { Habitacion } from './entities/habitacion.entity';
import { SearchAccommodationRequestDto, SearchAccommodationResponseDto } from './dto/search-accommodation.dto';
import {
  AvailabilityProductDto,
  AvailabilityRequestDto,
  AvailabilityResponseDto,
  NightPriceDto,
} from './dto/availability.dto';
import {
  AccommodationDetailsItemDto,
  AccommodationDetailsRequestDto,
  AccommodationDetailsResponseDto,
  DETAILS_EXTRAS,
} from './dto/accommodation-details.dto';
import { RecursoNoEncontradoException } from './problems/problem-details.exceptions';
import {
  acotarEntero,
  calcularNoches,
  codificarPagina,
  decodificarPagina,
  esIdPosible,
  repartirHuespedes,
  urlAlojamiento,
} from './alojamientos-consulta.utils';

@Injectable()
export class AlojamientosService {
  constructor(
    @InjectRepository(Alojamiento)
    private readonly alojamientosRepository: Repository<Alojamiento>,
    @InjectRepository(Habitacion)
    private readonly habitacionesRepository: Repository<Habitacion>,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  //  Búsqueda y Catálogo
  // ═══════════════════════════════════════════════════════════════════════

  // Alojamientos activos con al menos una habitación disponible en TODAS las noches del rango
  // [checkin, checkout), con cupos suficientes y donde caben los huéspedes. Una sola consulta.
  async search(searchRequest: SearchAccommodationRequestDto): Promise<SearchAccommodationResponseDto> {
    const noches = calcularNoches(searchRequest.checkin, searchRequest.checkout);
    const rows = searchRequest.rows ?? 100;
    const offset = decodificarPagina(searchRequest.page);
    const reparto = repartirHuespedes(searchRequest.guests);
    const respuesta: SearchAccommodationResponseDto = { request_id: randomUUID(), data: [], next_page: null };

    // Un id de ciudad fuera del rango de integer no puede existir.
    if (searchRequest.city !== undefined && !esIdPosible(searchRequest.city)) return respuesta;

    const consulta = this.alojamientosRepository
      .createQueryBuilder('a')
      .select('a.id', 'id')
      .leftJoin('a.ciudad', 'c')
      .where('a.activo = :activo', { activo: true });
    if (searchRequest.city !== undefined) consulta.andWhere('a.ciudadId = :ciudad', { ciudad: searchRequest.city });
    if (searchRequest.country) consulta.andWhere('c.pais = :pais', { pais: searchRequest.country });

    const hayHabitacionDisponible = consulta
      .subQuery()
      .select('1')
      .from(Habitacion, 'h')
      .innerJoin(DisponibilidadDiaria, 'd', 'd.habitacionId = h.id')
      .where('h.alojamientoId = a.id')
      .andWhere('h.capacidadAdultos >= :adultos')
      .andWhere('h.capacidadNinos >= :ninos')
      .andWhere('d.fecha >= :checkin AND d.fecha < :checkout')
      .andWhere('d.cupos >= :habitaciones')
      .groupBy('h.id')
      .having('COUNT(*) = :noches')
      .getQuery();

    const filas = await consulta
      .andWhere(`EXISTS ${hayHabitacionDisponible}`)
      .setParameters({
        adultos: reparto.adultosPorHabitacion,
        ninos: reparto.ninosPorHabitacion,
        habitaciones: reparto.habitaciones,
        checkin: searchRequest.checkin,
        checkout: searchRequest.checkout,
        noches,
      })
      .orderBy('a.id', 'ASC')
      .offset(offset)
      .limit(rows + 1) // una de más, solo para saber si hay otra página
      .getRawMany<{ id: number }>();

    respuesta.data = filas.slice(0, rows).map((fila) => ({ id: Number(fila.id), url: urlAlojamiento(Number(fila.id)) }));
    respuesta.next_page = filas.length > rows ? codificarPagina(offset + rows) : null;
    return respuesta;
  }

  getDetailsChanges(changesRequest: any): any {
    // TODO: Implementar consulta de cambios de alojamientos desde una fecha
    return { request_id: '', data: {} };
  }

  getChains(): any {
    // TODO: Implementar listado de cadenas hoteleras y marcas
    return { request_id: '', data: [] };
  }

  getConstants(constantsRequest: any): any {
    // TODO: Implementar consulta de constantes del sistema (facilidades, tipos de cuartos)
    return { request_id: '', data: {} };
  }

  getReviews(reviewsRequest: any): any {
    // TODO: Implementar obtención de reseñas de alojamientos
    return { request_id: '', data: [], next_page: null };
  }

  getReviewsScores(scoresRequest: any): any {
    // TODO: Implementar obtención de puntuaciones de reseñas
    return { request_id: '', data: [] };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Disponibilidad y Precios
  // ═══════════════════════════════════════════════════════════════════════

  // Habitaciones de un alojamiento activo que están libres todas las noches del rango y donde caben
  // los huéspedes, con el precio total = suma de las noches en disponibilidad_diaria. Una consulta.
  async checkAvailability(availabilityRequest: AvailabilityRequestDto): Promise<AvailabilityResponseDto> {
    const noches = calcularNoches(availabilityRequest.checkin, availabilityRequest.checkout);
    const reparto = repartirHuespedes(availabilityRequest.guests);
    const alojamiento = await this.buscarActivo(availabilityRequest.accommodation, 'accommodation');

    const filas = await this.habitacionesRepository
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
      .where('h.alojamientoId = :alojamiento', { alojamiento: alojamiento.id })
      .andWhere('h.capacidadAdultos >= :adultos', { adultos: reparto.adultosPorHabitacion })
      .andWhere('h.capacidadNinos >= :ninos', { ninos: reparto.ninosPorHabitacion })
      .andWhere('d.fecha >= :checkin AND d.fecha < :checkout', {
        checkin: availabilityRequest.checkin,
        checkout: availabilityRequest.checkout,
      })
      .andWhere('d.cupos >= :habitaciones', { habitaciones: reparto.habitaciones })
      .groupBy('h.id')
      .having('COUNT(*) = :noches', { noches })
      .getRawMany<{
        id: string;
        nombre: string;
        tipo: string;
        mealPlan: string | null;
        cancellationType: string | null;
        capacidadAdultos: number;
        capacidadNinos: number;
        total: string;
        cuposMinimos: number;
        desglose: NightPriceDto[];
      }>();

    const products: AvailabilityProductDto[] = filas
      .map((fila) => ({
        product_id: fila.id,
        name: fila.nombre,
        type: fila.tipo,
        meal_plan: fila.mealPlan,
        cancellation_type: fila.cancellationType,
        max_adults: Number(fila.capacidadAdultos),
        max_children: Number(fila.capacidadNinos),
        rooms_left: Number(fila.cuposMinimos),
        price: { currency: alojamiento.moneda, total: Number(fila.total), nights: fila.desglose },
      }))
      .sort((a, b) => a.price.total - b.price.total || a.name.localeCompare(b.name));

    return {
      request_id: randomUUID(),
      data: { id: alojamiento.id, currency: alojamiento.moneda, products, url: urlAlojamiento(alojamiento.id) },
    };
  }

  checkBulkAvailability(bulkRequest: any): any {
    // TODO: Implementar consulta de disponibilidad múltiple
    return { request_id: '', data: [] };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Búsqueda y Catálogo: detalles
  // ═══════════════════════════════════════════════════════════════════════

  // Ficha de los alojamientos activos: por ids (si alguno no existe o está inactivo, 404) o por ciudad/país.
  // Dos consultas en total (alojamientos con su ciudad + habitaciones de todos), sin N+1.
  async getDetails(detailsRequest: AccommodationDetailsRequestDto): Promise<AccommodationDetailsResponseDto> {
    const extras = new Set<string>(detailsRequest.extras?.length ? detailsRequest.extras : DETAILS_EXTRAS);
    const ids = detailsRequest.accommodations?.length ? [...new Set(detailsRequest.accommodations)] : undefined;
    let alojamientos: Alojamiento[] = [];

    if (ids) {
      const posibles = ids.filter(esIdPosible);
      if (posibles.length > 0) {
        alojamientos = await this.alojamientosRepository.find({
          where: { id: Any(posibles), activo: true },
          relations: { ciudad: true },
          order: { id: 'ASC' },
        });
      }
      const encontrados = new Set(alojamientos.map((a) => a.id));
      const faltantes = ids.filter((id) => !encontrados.has(id));
      if (faltantes.length > 0) {
        const reason = `No existen o están inactivos: ${faltantes.join(', ')}`;
        throw new RecursoNoEncontradoException(`Alojamientos no encontrados: ${faltantes.join(', ')}`, [
          { name: 'accommodations', reason },
        ]);
      }
    } else if (detailsRequest.city === undefined || esIdPosible(detailsRequest.city)) {
      const where: FindOptionsWhere<Alojamiento> = { activo: true };
      if (detailsRequest.city !== undefined) where.ciudadId = detailsRequest.city;
      if (detailsRequest.country) where.ciudad = { pais: detailsRequest.country };
      alojamientos = await this.alojamientosRepository.find({ where, relations: { ciudad: true }, order: { id: 'ASC' } });
    }

    const habitacionesPorAlojamiento = new Map<number, Habitacion[]>();
    if (extras.has('rooms') && alojamientos.length > 0) {
      const habitaciones = await this.habitacionesRepository.find({
        where: { alojamientoId: Any(alojamientos.map((a) => a.id)) },
        order: { precioBase: 'ASC', nombre: 'ASC' },
      });
      for (const h of habitaciones) {
        habitacionesPorAlojamiento.set(h.alojamientoId, [...(habitacionesPorAlojamiento.get(h.alojamientoId) ?? []), h]);
      }
    }

    const data = alojamientos.map((a): AccommodationDetailsItemDto => {
      const ficha: AccommodationDetailsItemDto = {
        id: a.id,
        name: a.nombre,
        city: a.ciudad ? { id: a.ciudad.id, name: a.ciudad.nombre, country: a.ciudad.pais } : null,
        currency: a.moneda,
      };
      if (extras.has('description')) ficha.description = a.descripcion;
      if (extras.has('photos')) ficha.photos = a.fotos;
      if (extras.has('facilities')) ficha.facilities = a.facilidades;
      if (extras.has('policies')) ficha.policies = a.politicas;
      if (extras.has('rooms')) {
        ficha.rooms = (habitacionesPorAlojamiento.get(a.id) ?? []).map((h) => ({
          product_id: h.id,
          name: h.nombre,
          type: h.tipo,
          max_adults: h.capacidadAdultos,
          max_children: h.capacidadNinos,
          base_price: h.precioBase,
          meal_plan: h.mealPlan,
          cancellation_type: h.cancellationType,
        }));
      }
      return ficha;
    });

    return { request_id: randomUUID(), data, next_page: null };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Gestión de Órdenes (Reservas)
  // ═══════════════════════════════════════════════════════════════════════

  previewOrder(previewRequest: any): any {
    // TODO: Implementar previsualización de orden (precio final antes de pagar)
    return { request_id: '', data: {} };
  }

  createOrder(createRequest: any): any {
    // TODO: Implementar creación formal de reserva/orden
    return {};
  }

  getOrder(orderId: string): any {
    // TODO: Implementar obtención de detalle de orden por ID
    return {};
  }

  modifyOrder(orderId: string, modifyRequest: any): any {
    // TODO: Implementar modificación de orden existente
    return {};
  }

  cancelOrder(orderId: string): any {
    // TODO: Implementar cancelación de orden
    return {};
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Webhooks
  // ═══════════════════════════════════════════════════════════════════════

  listWebhooks(): any[] {
    // TODO: Implementar listado de suscripciones a webhooks
    return [];
  }

  createWebhook(webhookSubscription: any): any {
    // TODO: Implementar registro de webhook
    return {};
  }

  deleteWebhook(id: string): void {
    // TODO: Implementar eliminación de suscripción de webhook
  }

  // ───────────────────────── Apoyo ─────────────────────────

  // Un alojamiento inactivo cuenta como inexistente para las rutas del contrato.
  private async buscarActivo(id: number, parametro: string): Promise<Alojamiento> {
    const alojamiento = esIdPosible(id)
      ? await this.alojamientosRepository.findOneBy({ id: acotarEntero(id), activo: true })
      : null;
    if (!alojamiento) {
      const reason = `El alojamiento ${id} no existe o está inactivo`;
      throw new RecursoNoEncontradoException(reason, [{ name: parametro, reason }]);
    }
    return alojamiento;
  }
}
