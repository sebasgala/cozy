import { randomInt, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { Alojamiento } from './entities/alojamiento.entity';
import { Habitacion } from './entities/habitacion.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { Orden, OrdenStatus } from './entities/orden.entity';
import { OrdenPreview } from './entities/orden-preview.entity';
import { OrderPreviewRequestDto, OrderPreviewResponseDto } from './dto/order-preview.dto';
import { OrderCreateRequestDto } from './dto/order-create.dto';
import { OrderDetailDto } from './dto/order-detail.dto';
import { DisponibilidadService } from './disponibilidad.service';
import {
  ClaveIdempotenciaReutilizadaException,
  ConflictoException,
  ConsultaInvalidaException,
  RecursoNoEncontradoException,
} from './problems/problem-details.exceptions';
import { calcularNoches, esUuid, huellaDePeticion, precioOrden, repartirHuespedes } from './alojamientos-consulta.utils';

// El contrato no dice cuánto dura una vista previa: 15 minutos.
const MINUTOS_VIGENCIA_PREVIEW = 15;
const ENDPOINT_CREATE = 'POST /orders/create';
// Localizador legible: sin 0/O ni 1/I para que no se confundan al dictarlo.
const ALFABETO_LOCATOR = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LARGO_LOCATOR = 8;

export interface RespuestaCreacion {
  statusCode: number;
  body: OrderDetailDto;
}

@Injectable()
export class OrdenesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Habitacion)
    private readonly habitacionesRepository: Repository<Habitacion>,
    @InjectRepository(OrdenPreview)
    private readonly previewsRepository: Repository<OrdenPreview>,
    @InjectRepository(Orden)
    private readonly ordenesRepository: Repository<Orden>,
    @InjectRepository(IdempotencyKey)
    private readonly clavesRepository: Repository<IdempotencyKey>,
    private readonly disponibilidadService: DisponibilidadService,
  ) {}

  // ───────────────────────── POST /orders/preview ─────────────────────────

  // Comprueba disponibilidad y calcula el precio con la función compartida. No descuenta cupos.
  async preview(request: OrderPreviewRequestDto): Promise<OrderPreviewResponseDto> {
    const noches = calcularNoches(request.checkin, request.checkout);
    const reparto = repartirHuespedes(request.guests);
    const alojamiento = await this.disponibilidadService.buscarAlojamientoActivo(request.accommodation_id, 'accommodation_id');

    const habitacion = esUuid(request.product_id)
      ? await this.habitacionesRepository.findOneBy({ id: request.product_id, alojamientoId: alojamiento.id })
      : null;
    if (!habitacion) {
      const reason = `La habitación ${request.product_id} no existe en el alojamiento ${alojamiento.id}`;
      throw new RecursoNoEncontradoException(reason, [{ name: 'product_id', reason }]);
    }
    if (habitacion.capacidadAdultos < reparto.adultosPorHabitacion || habitacion.capacidadNinos < reparto.ninosPorHabitacion) {
      throw new ConsultaInvalidaException([
        {
          name: 'guests',
          reason: `No caben en la habitación: máximo ${habitacion.capacidadAdultos} adultos y ${habitacion.capacidadNinos} niños por habitación`,
        },
      ]);
    }

    const [disponible] = await this.disponibilidadService.habitacionesDisponibles({
      alojamientoId: alojamiento.id,
      habitacionId: habitacion.id,
      checkin: request.checkin,
      checkout: request.checkout,
      noches,
      reparto,
    });
    if (!disponible) {
      throw new ConflictoException('ROOM_NO_LONGER_AVAILABLE', 'La habitación no tiene cupos suficientes en todas las noches pedidas', [
        { name: 'product_id', reason: 'Sin cupos suficientes para esas fechas' },
      ]);
    }

    const preview = await this.previewsRepository.save(
      this.previewsRepository.create({
        alojamientoId: alojamiento.id,
        habitacionId: habitacion.id,
        guests: { ...request.guests },
        checkin: request.checkin,
        checkout: request.checkout,
        totalPrice: precioOrden(disponible.total, reparto.habitaciones),
        currency: alojamiento.moneda,
        expiresAt: new Date(Date.now() + MINUTOS_VIGENCIA_PREVIEW * 60 * 1000),
      }),
    );

    return {
      request_id: randomUUID(),
      data: { order_preview_id: preview.id, total_price: preview.totalPrice, currency: preview.currency },
    };
  }

  // ───────────────────────── POST /orders/create ─────────────────────────

  // Idempotencia: misma clave + mismo cuerpo => la respuesta guardada (sin crear otra orden);
  // misma clave + cuerpo distinto => 422. Solo se guardan las creaciones exitosas.
  async crear(idempotencyKey: string, request: OrderCreateRequestDto): Promise<RespuestaCreacion> {
    const huella = huellaDePeticion(request);
    const guardada = await this.clavesRepository.findOneBy({ key: idempotencyKey });
    if (guardada) return this.repetirRespuesta(guardada, huella);

    for (let intento = 1; ; intento++) {
      try {
        const body = await this.dataSource.transaction((manager) => this.crearEnTransaccion(manager, idempotencyKey, huella, request));
        return { statusCode: 201, body };
      } catch (error) {
        // Otra petición con la misma clave terminó primero: se responde lo que ella guardó.
        if (this.esViolacionUnica(error, 'idempotency_keys')) {
          const ganadora = await this.clavesRepository.findOneBy({ key: idempotencyKey });
          if (ganadora) return this.repetirRespuesta(ganadora, huella);
        }
        // Colisión de localizador (casi imposible): se repite la transacción entera.
        if (this.esViolacionUnica(error, 'ordenes') && intento < 3) continue;
        throw error;
      }
    }
  }

  // Todo o nada: si algo falla, PostgreSQL deshace los cupos descontados, la orden y la clave.
  private async crearEnTransaccion(
    manager: EntityManager,
    idempotencyKey: string,
    huella: string,
    request: OrderCreateRequestDto,
  ): Promise<OrderDetailDto> {
    const preview = esUuid(request.order_preview_id)
      ? await manager.findOneBy(OrdenPreview, { id: request.order_preview_id })
      : null;
    if (!preview || !preview.checkin || !preview.checkout) {
      throw new ConsultaInvalidaException([{ name: 'order_preview_id', reason: 'La vista previa no existe' }]);
    }
    if (preview.expiresAt.getTime() <= Date.now()) {
      throw new ConsultaInvalidaException([
        { name: 'order_preview_id', reason: 'La vista previa expiró: pide una nueva con /orders/preview' },
      ]);
    }

    const alojamiento = await manager.findOneBy(Alojamiento, { id: preview.alojamientoId, activo: true });
    if (!alojamiento) {
      throw new ConflictoException('ROOM_NO_LONGER_AVAILABLE', 'El alojamiento ya no está disponible');
    }

    const reparto = repartirHuespedes(preview.guests as { number_of_adults: number; number_of_rooms: number; children?: number[] });
    const noches = calcularNoches(preview.checkin, preview.checkout);

    // 1. Bloqueo pesimista de las noches: otra creación sobre la misma habitación espera aquí.
    await this.disponibilidadService.bloquearNoches(manager, preview.habitacionId, preview.checkin, preview.checkout);

    // 2. Con las filas bloqueadas se recalcula disponibilidad y precio con la misma función compartida.
    const [disponible] = await this.disponibilidadService.habitacionesDisponibles(
      {
        alojamientoId: alojamiento.id,
        habitacionId: preview.habitacionId,
        checkin: preview.checkin,
        checkout: preview.checkout,
        noches,
        reparto,
      },
      manager,
    );
    if (!disponible) {
      throw new ConflictoException('ROOM_NO_LONGER_AVAILABLE', 'La habitación ya no tiene cupos suficientes en todas las noches', [
        { name: 'order_preview_id', reason: 'Otra reserva tomó los cupos: pide una nueva vista previa' },
      ]);
    }
    const total = precioOrden(disponible.total, reparto.habitaciones);
    if (total !== Number(preview.totalPrice)) {
      throw new ConflictoException('PRICE_CHANGED', `El precio cambió de ${preview.totalPrice} a ${total}: pide una nueva vista previa`);
    }

    // 3. Descuento de cupos, orden y clave de idempotencia, en la misma transacción.
    await this.disponibilidadService.descontarCupos(
      manager,
      preview.habitacionId,
      preview.checkin,
      preview.checkout,
      reparto.habitaciones,
      noches,
    );

    const orden = await manager.save(
      manager.create(Orden, {
        locator: await this.generarLocator(manager),
        status: OrdenStatus.CONFIRMED, // pago simulado: se considera aprobado
        alojamientoId: alojamiento.id,
        habitacionId: preview.habitacionId,
        guests: preview.guests,
        checkin: preview.checkin,
        checkout: preview.checkout,
        customerFirstName: request.customer_details.first_name,
        customerLastName: request.customer_details.last_name,
        customerEmail: request.customer_details.email,
        totalPrice: total,
        currency: preview.currency,
        paymentReference: request.payment_reference,
        ownerId: null, // PENDIENTE: saldrá del `sub` del JWT cuando exista autenticación
      }),
    );

    const detalle = this.aDetalle(orden, alojamiento.nombre, disponible.nombre, disponible.cancellationType);
    await manager.insert(IdempotencyKey, {
      key: idempotencyKey,
      endpoint: ENDPOINT_CREATE,
      statusCode: 201,
      // El tipo de insert() de TypeORM no acepta objetos con tipo propio en una columna jsonb.
      responseBody: detalle as any,
      requestHash: huella,
    });
    return detalle;
  }

  private repetirRespuesta(guardada: IdempotencyKey, huella: string): RespuestaCreacion {
    if (guardada.endpoint !== ENDPOINT_CREATE || guardada.requestHash !== huella) {
      throw new ClaveIdempotenciaReutilizadaException([
        { name: 'Idempotency-Key', reason: 'Esta clave ya se usó con un cuerpo distinto: usa una clave nueva' },
      ]);
    }
    return { statusCode: guardada.statusCode, body: guardada.responseBody as OrderDetailDto };
  }

  // ───────────────────────── GET /orders/{orderId} ─────────────────────────

  async obtener(orderId: string): Promise<OrderDetailDto> {
    const orden = await this.ordenesRepository.findOne({
      where: { id: orderId },
      relations: { alojamiento: true, habitacion: true },
    });
    if (!orden) throw this.ordenNoEncontrada(orderId);
    return this.aDetalle(orden, orden.alojamiento.nombre, orden.habitacion.nombre, orden.habitacion.cancellationType);
  }

  // ───────────────────────── POST /orders/{orderId}/cancel ─────────────────────────

  // Pasa la orden a CANCELLED y devuelve los cupos, en una transacción. La fila de la orden se bloquea
  // para que dos cancelaciones simultáneas no devuelvan los cupos dos veces. Si ya estaba cancelada,
  // responde la orden tal cual. No se aplica política de cancelación: el contrato no la define.
  async cancelar(orderId: string): Promise<OrderDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const orden = await manager
        .getRepository(Orden)
        .createQueryBuilder('o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!orden) throw this.ordenNoEncontrada(orderId);
      if (orden.status === OrdenStatus.CANCELLED) return;

      const reparto = repartirHuespedes(orden.guests as { number_of_adults: number; number_of_rooms: number; children?: number[] });
      await this.disponibilidadService.devolverCupos(manager, orden.habitacionId, orden.checkin, orden.checkout, reparto.habitaciones);
      orden.status = OrdenStatus.CANCELLED;
      await manager.save(orden);
    });
    return this.obtener(orderId);
  }

  // ───────────────────────── Apoyo ─────────────────────────

  private async generarLocator(manager: EntityManager): Promise<string> {
    for (let intento = 0; intento < 5; intento++) {
      const locator = Array.from({ length: LARGO_LOCATOR }, () => ALFABETO_LOCATOR[randomInt(ALFABETO_LOCATOR.length)]).join('');
      if (!(await manager.existsBy(Orden, { locator }))) return locator;
    }
    throw new Error('No se pudo generar un localizador único');
  }

  private aDetalle(orden: Orden, nombreAlojamiento: string, nombreHabitacion: string, cancellationType: string | null): OrderDetailDto {
    const guests = orden.guests as { number_of_rooms: number };
    const base = `/api/v1/orders/${orden.id}`;
    return {
      order_id: orden.id,
      locator: orden.locator,
      status: orden.status,
      accommodation_details: {
        accommodation_id: orden.alojamientoId,
        name: nombreAlojamiento,
        product_id: orden.habitacionId,
        room_name: nombreHabitacion,
        cancellation_type: cancellationType,
        checkin: orden.checkin,
        checkout: orden.checkout,
        nights: calcularNoches(orden.checkin, orden.checkout),
        rooms: guests.number_of_rooms,
        guests: orden.guests,
      },
      total_price: Number(orden.totalPrice),
      currency: orden.currency,
      creation_date: new Date(orden.createdAt).toISOString(),
      _links:
        orden.status === OrdenStatus.CANCELLED
          ? { self: base }
          : { self: base, modify: `${base}/modify`, cancel: `${base}/cancel` },
    };
  }

  private ordenNoEncontrada(orderId: string): RecursoNoEncontradoException {
    const reason = `La orden ${orderId} no existe`;
    return new RecursoNoEncontradoException(reason, [{ name: 'orderId', reason }]);
  }

  private esViolacionUnica(error: unknown, tabla: string): boolean {
    const driver = error instanceof QueryFailedError ? (error.driverError as { code?: string; table?: string }) : undefined;
    return driver?.code === '23505' && driver?.table === tabla;
  }
}
