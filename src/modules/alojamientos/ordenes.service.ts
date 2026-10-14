import { randomInt, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { Alojamiento } from './entities/alojamiento.entity';
import { Habitacion } from './entities/habitacion.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { Orden, OrdenStatus, UQ_ORDENES_LOCATOR, UQ_ORDENES_PREVIEW } from './entities/orden.entity';
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
import { calcularNoches, esUuid, huellaDePeticion, interpretarProductId, precioOrden, repartirHuespedes } from './alojamientos-consulta.utils';

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
    // El product_id ya trae la habitación y las fechas (formato <uuid>:<checkin>:<checkout>).
    const oferta = interpretarProductId(request.product_id);
    const noches = calcularNoches(oferta.checkin, oferta.checkout);
    const reparto = repartirHuespedes(request.guests);
    const alojamiento = await this.disponibilidadService.buscarAlojamientoActivo(request.accommodation_id, 'accommodation_id');

    const habitacion = await this.habitacionesRepository.findOneBy({ id: oferta.habitacionId, alojamientoId: alojamiento.id, activo: true });
    if (!habitacion) {
      const reason = `La habitación ${oferta.habitacionId} no existe en el alojamiento ${alojamiento.id}`;
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
      checkin: oferta.checkin,
      checkout: oferta.checkout,
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
        checkin: oferta.checkin,
        checkout: oferta.checkout,
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
  // Un preview da una sola orden: otra clave sobre un preview ya usado => 409.
  async crear(idempotencyKey: string, request: OrderCreateRequestDto): Promise<RespuestaCreacion> {
    const huella = huellaDePeticion(request);
    const guardada = await this.clavesRepository.findOneBy({ key: idempotencyKey });
    if (guardada) return this.repetirRespuesta(guardada, huella);

    for (let intento = 1; ; intento++) {
      try {
        return await this.dataSource.transaction((manager) => this.crearEnTransaccion(manager, idempotencyKey, huella, request));
      } catch (error) {
        const violacion = this.violacionUnica(error);
        // Otra petición con la misma clave terminó primero: se responde lo que ella guardó.
        if (violacion?.table === 'idempotency_keys') {
          const ganadora = await this.clavesRepository.findOneBy({ key: idempotencyKey });
          if (ganadora) return this.repetirRespuesta(ganadora, huella);
        }
        // Respaldo del bloqueo del preview: el índice único también impide dos órdenes por preview.
        if (violacion?.constraint === UQ_ORDENES_PREVIEW) throw this.previewYaUsado();
        // Colisión de localizador (casi imposible): se repite la transacción entera.
        if (violacion?.constraint === UQ_ORDENES_LOCATOR && intento < 3) continue;
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
  ): Promise<RespuestaCreacion> {
    // 1. Bloqueo del preview: dos creaciones sobre el mismo preview pasan de a una.
    const preview = esUuid(request.order_preview_id)
      ? await manager
          .getRepository(OrdenPreview)
          .createQueryBuilder('p')
          .setLock('pessimistic_write')
          .where('p.id = :id', { id: request.order_preview_id })
          .getOne()
      : null;
    if (!preview) {
      throw new ConsultaInvalidaException([{ name: 'order_preview_id', reason: 'La vista previa no existe' }]);
    }
    // 2. Si mientras esperábamos el bloqueo terminó otra petición con la MISMA clave, se repite su respuesta.
    const ganadora = await manager.findOneBy(IdempotencyKey, { key: idempotencyKey });
    if (ganadora) return this.repetirRespuesta(ganadora, huella);
    // 3. Con OTRA clave, un preview ya usado es un conflicto: no se crea una segunda orden.
    if (await manager.existsBy(Orden, { previewId: preview.id })) throw this.previewYaUsado();

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

    // 4. Bloqueo pesimista de las noches: otra creación sobre la misma habitación espera aquí.
    await this.disponibilidadService.bloquearNoches(manager, preview.habitacionId, preview.checkin, preview.checkout);

    // 5. Con las filas bloqueadas se recalcula disponibilidad y precio con la misma función compartida.
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

    // 6. Descuento de cupos, orden y clave de idempotencia, en la misma transacción.
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
        previewId: preview.id,
        habitacionesReservadas: reparto.habitaciones,
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
    return { statusCode: 201, body: detalle };
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

      // Mismo orden de bloqueo que el create y que la edición del admin (por fecha): evita bloqueos cruzados.
      await this.disponibilidadService.bloquearNoches(manager, orden.habitacionId, orden.checkin, orden.checkout);
      // Devuelve exactamente los cupos que se descontaron al crear (columna, no el JSON de huéspedes).
      await this.disponibilidadService.devolverCupos(manager, orden.habitacionId, orden.checkin, orden.checkout, orden.habitacionesReservadas);
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
        rooms: orden.habitacionesReservadas,
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

  private previewYaUsado(): ConflictoException {
    return new ConflictoException(
      'ROOM_NO_LONGER_AVAILABLE',
      'La vista previa ya se usó para crear una orden: pide una nueva con /orders/preview',
      [{ name: 'order_preview_id', reason: 'ya se usó para crear una orden' }],
    );
  }

  // Datos de una violación de UNIQUE (23505) de PostgreSQL; undefined si el error es otro.
  private violacionUnica(error: unknown): { table?: string; constraint?: string } | undefined {
    const driver = error instanceof QueryFailedError ? (error.driverError as { code?: string; table?: string; constraint?: string }) : undefined;
    return driver?.code === '23505' ? driver : undefined;
  }
}
