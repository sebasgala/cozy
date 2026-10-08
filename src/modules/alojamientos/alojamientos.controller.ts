import {
  Controller, Get, Post, Delete, Body, Param, Headers, Res,
  ParseUUIDPipe, UseGuards, UseFilters, HttpCode, HttpStatus, Header,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags, ApiOperation, ApiResponse, ApiParam,
  ApiHeader, ApiSecurity, ApiBody, ApiExtraModels, getSchemaPath,
} from '@nestjs/swagger';
import { AlojamientosService } from './alojamientos.service';
import { IdempotencyKeyGuard } from '../../common/guards/idempotency-key.guard';
import { SearchAccommodationRequestDto, SearchAccommodationResponseDto } from './dto/search-accommodation.dto';
import { AvailabilityRequestDto, AvailabilityResponseDto } from './dto/availability.dto';
import { AccommodationDetailsRequestDto, AccommodationDetailsResponseDto } from './dto/accommodation-details.dto';
import { ProblemDetailsDto } from './dto/problem-details.dto';
import { ProblemDetailsFilter } from './problems/problem-details.filter';
import { ConsultaInvalidaException } from './problems/problem-details.exceptions';
import { OrdenesService } from './ordenes.service';
import { OrderPreviewRequestDto, OrderPreviewResponseDto } from './dto/order-preview.dto';
import { OrderCreateRequestDto } from './dto/order-create.dto';
import { OrderDetailDto } from './dto/order-detail.dto';
import { validarIdempotencyKey } from './alojamientos-consulta.utils';

// ─────────────────────────────────────────────────────────────────────────────
// Controlador BFF de Alojamientos — Alineado 1:1 con alojamientos-openapi.yaml
//
// Implementadas con datos reales: /search, /availability y /details (públicas en el
// contrato: `security: []`, por eso no piden token) y el flujo de venta /orders/preview,
// /orders/create, GET /orders/{orderId} y /orders/{orderId}/cancel. El resto sigue con datos de relleno.
//
// PENDIENTE (autenticación): el contrato protege las rutas de órdenes con OAuth2 (scopes
// alojamientos:read, :book y :cancel). Todavía no hay JWT: no se bloquea nada y ownerId queda null.
// ─────────────────────────────────────────────────────────────────────────────

// orderId con formato UUID; si no lo es, 400 en formato ProblemDetails (y no un 500 de PostgreSQL).
const uuidDeOrden = () =>
  new ParseUUIDPipe({
    exceptionFactory: () => new ConsultaInvalidaException([{ name: 'orderId', reason: 'orderId debe ser un UUID válido' }]),
  });

const CABECERA_IDEMPOTENCIA = {
  name: 'Idempotency-Key',
  required: true,
  description: 'UUID. Repetir la petición con la misma clave y el mismo cuerpo devuelve la misma respuesta sin repetir la operación',
  example: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
};

// Los errores del contrato son application/problem+json con el esquema ProblemDetails.
const respuestaProblema = (status: number, description: string) => ({
  status,
  description,
  content: { 'application/problem+json': { schema: { $ref: getSchemaPath(ProblemDetailsDto) } } },
});

// Cabeceras de las respuestas 200 de /search y /details según el contrato.
const CABECERAS_200 = {
  'Cache-Control': { description: 'Caché pública de 5 minutos', schema: { type: 'string', example: 'public, max-age=300' } },
  'X-API-Deprecation-Date': {
    description: 'Fecha prevista de baja de esta versión de la API',
    schema: { type: 'string', format: 'date', example: '2027-12-31' },
  },
};

// Valores reales de esas cabeceras. Se asignan solo cuando la respuesta es 200: un error no debe cachearse.
const CABECERAS_CATALOGO = {
  'Cache-Control': 'public, max-age=300',
  'X-API-Deprecation-Date': '2027-12-31',
};

const BOOKER_EJEMPLO = { country: 'ec', platform: 'desktop' };

@ApiExtraModels(ProblemDetailsDto)
@Controller()
export class AlojamientosController {
  constructor(
    private readonly alojamientosService: AlojamientosService,
    private readonly ordenesService: OrdenesService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  //  Búsqueda y Catálogo
  // ══════════════════════════════════════════════════════════════════════════

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @UseFilters(ProblemDetailsFilter)
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({
    summary: 'Búsqueda de alojamientos',
    description:
      'Devuelve los alojamientos activos con al menos una habitación libre todas las noches de [checkin, checkout) ' +
      'donde caben los huéspedes. Filtra por `city` (id entero) y/o `country`. Paginado con `rows` y `page`/`next_page`. ' +
      'No se convierte moneda: `currency`, `extras`, `booker` y `allocation` se validan pero no cambian el resultado.',
  })
  @ApiHeader({ name: 'X-Device-Fingerprint', required: true, description: 'Identificador del dispositivo', example: 'dev-1234' })
  @ApiBody({
    type: SearchAccommodationRequestDto,
    examples: {
      'Quito, 3 noches (incluye fin de semana)': {
        value: {
          booker: BOOKER_EJEMPLO,
          checkin: '2026-10-09',
          checkout: '2026-10-12',
          city: 1,
          guests: { number_of_adults: 2, number_of_rooms: 1, children: [5] },
          rows: 10,
        },
      },
      'Todo Ecuador, sin niños': {
        value: {
          booker: BOOKER_EJEMPLO,
          checkin: '2026-10-20',
          checkout: '2026-10-22',
          country: 'ec',
          guests: { number_of_adults: 1, number_of_rooms: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Alojamientos encontrados', type: SearchAccommodationResponseDto, headers: CABECERAS_200 })
  @ApiResponse(respuestaProblema(400, 'Petición inválida (campos faltantes o mal formados, checkout no posterior a checkin, cabecera ausente)'))
  @ApiResponse({ status: 429, description: 'Demasiadas peticiones (pendiente: todavía no hay límite de tasa)' })
  async search(
    @Headers('X-Device-Fingerprint') deviceFingerprint: string,
    @Body() searchRequest: SearchAccommodationRequestDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!deviceFingerprint?.trim()) {
      throw new ConsultaInvalidaException([{ name: 'X-Device-Fingerprint', reason: 'La cabecera X-Device-Fingerprint es obligatoria' }]);
    }
    const resultado = await this.alojamientosService.search(searchRequest);
    res.set(CABECERAS_CATALOGO);
    return resultado;
  }

  @Post('availability')
  @HttpCode(HttpStatus.OK)
  @UseFilters(ProblemDetailsFilter)
  @ApiTags('Disponibilidad y Precios')
  @ApiOperation({
    summary: 'Consultar disponibilidad y precio de un alojamiento',
    description:
      'Habitaciones del alojamiento libres todas las noches de [checkin, checkout) donde caben los huéspedes. ' +
      '`price.total` es la suma de las noches de disponibilidad_diaria, por habitación, en la moneda del alojamiento. ' +
      'Un alojamiento inexistente o inactivo responde 404.',
  })
  @ApiBody({
    type: AvailabilityRequestDto,
    examples: {
      'Cozy Boutique Quito, fin de semana': {
        value: {
          accommodation: 1,
          booker: BOOKER_EJEMPLO,
          checkin: '2026-10-09',
          checkout: '2026-10-12',
          guests: { number_of_adults: 2, number_of_rooms: 1, children: [5] },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Disponibilidad y detalles del precio', type: AvailabilityResponseDto })
  @ApiResponse(respuestaProblema(400, 'Petición inválida'))
  @ApiResponse(respuestaProblema(404, 'El alojamiento no existe o está inactivo (no está definido en el contrato)'))
  availability(@Body() availabilityRequest: AvailabilityRequestDto) {
    return this.alojamientosService.checkAvailability(availabilityRequest);
  }

  @Post('bulk-availability')
  @ApiTags('Disponibilidad y Precios')
  @ApiOperation({
    summary: 'Consultar disponibilidad múltiple de alojamientos',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe BulkAvailabilityRequest del contrato.',
  })
  @ApiResponse({ status: 200, description: 'Disponibilidad para múltiples alojamientos' })
  bulkAvailability(@Body() bulkRequest: any) {
    return this.alojamientosService.checkBulkAvailability(bulkRequest);
  }

  @Post('details')
  @HttpCode(HttpStatus.OK)
  @UseFilters(ProblemDetailsFilter)
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({
    summary: 'Obtener detalles extendidos de los alojamientos',
    description:
      'Ficha de los alojamientos activos: por `accommodations` (ids enteros; si alguno no existe o está inactivo, 404) ' +
      'o por `city`/`country`. `extras` elige los bloques (description, photos, facilities, policies, rooms); ' +
      'si se omite se devuelven todos. `bundles` y `payment` no existen en nuestro modelo y se ignoran.',
  })
  @ApiBody({
    type: AccommodationDetailsRequestDto,
    examples: {
      'Ficha completa de dos alojamientos': { value: { accommodations: [1, 3] } },
      'Solo fotos y habitaciones de una ciudad': { value: { city: 1, extras: ['photos', 'rooms'] } },
    },
  })
  @ApiResponse({ status: 200, description: 'Detalles de los alojamientos solicitados', type: AccommodationDetailsResponseDto, headers: CABECERAS_200 })
  @ApiResponse(respuestaProblema(400, 'Petición inválida'))
  @ApiResponse(respuestaProblema(404, 'Algún alojamiento pedido no existe o está inactivo (no está definido en el contrato)'))
  async getDetails(@Body() detailsRequest: AccommodationDetailsRequestDto, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.alojamientosService.getDetails(detailsRequest);
    res.set(CABECERAS_CATALOGO);
    return resultado;
  }

  @Post('details/changes')
  @ApiTags('Búsqueda y Catálogo')
  @ApiSecurity('OAuth2Security', ['alojamientos:read'])
  @ApiOperation({
    summary: 'Obtener alojamientos que han cambiado desde una fecha',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe DetailsChangesRequest del contrato. Pide el scope OAuth2 alojamientos:read (pendiente).',
  })
  @ApiResponse({ status: 200, description: 'Lista de alojamientos modificados' })
  getDetailsChanges(@Body() changesRequest: any) {
    return this.alojamientosService.getDetailsChanges(changesRequest);
  }

  @Post('chains')
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({
    summary: 'Listar cadenas hoteleras y sus marcas',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Responde con Cache-Control de 1 hora.',
  })
  @ApiResponse({ status: 200, description: 'Lista de cadenas hoteleras' })
  @Header('Cache-Control', 'public, max-age=3600')
  getChains() {
    return this.alojamientosService.getChains();
  }

  @Post('constants')
  @ApiTags('Componentes Comunes')
  @ApiOperation({
    summary: 'Consultar constantes del sistema (facilidades, tipos de cuartos, etc.)',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe ConstantsRequest del contrato. Responde con Cache-Control de 24 horas.',
  })
  @ApiResponse({ status: 200, description: 'Constantes del sistema' })
  @Header('Cache-Control', 'public, max-age=86400')
  getConstants(@Body() constantsRequest: any) {
    return this.alojamientosService.getConstants(constantsRequest);
  }

  @Post('reviews')
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({
    summary: 'Obtener reseñas de alojamientos',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe ReviewsRequest del contrato. Responde con Cache-Control de 10 minutos.',
  })
  @ApiResponse({ status: 200, description: 'Reseñas de los alojamientos' })
  @Header('Cache-Control', 'public, max-age=600')
  getReviews(@Body() reviewsRequest: any) {
    return this.alojamientosService.getReviews(reviewsRequest);
  }

  @Post('reviews/scores')
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({
    summary: 'Obtener puntuaciones de reseñas',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe ReviewsScoresRequest del contrato. Responde con Cache-Control de 10 minutos.',
  })
  @ApiResponse({ status: 200, description: 'Puntuaciones desglosadas' })
  @Header('Cache-Control', 'public, max-age=600')
  getReviewsScores(@Body() scoresRequest: any) {
    return this.alojamientosService.getReviewsScores(scoresRequest);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Gestión de Órdenes (Reservas)
  // ══════════════════════════════════════════════════════════════════════════

  @Post('orders/preview')
  @HttpCode(HttpStatus.OK)
  @UseFilters(ProblemDetailsFilter)
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['alojamientos:read'])
  @ApiOperation({
    summary: 'Previsualizar orden antes de confirmar',
    description:
      'Comprueba disponibilidad y calcula el precio final (suma de las noches por habitación × habitaciones). ' +
      'Guarda la vista previa 15 minutos y NO descuenta cupos. Las fechas y la habitación salen del `product_id` ' +
      '(`<uuid-habitación>:<checkin>:<checkout>`), que debe obtenerse de /availability. ' +
      'PENDIENTE: el contrato exige OAuth2 (alojamientos:read); todavía no hay autenticación.',
  })
  @ApiBody({
    type: OrderPreviewRequestDto,
    examples: {
      'Suite Junior, fin de semana': {
        value: {
          accommodation_id: 1,
          product_id: '704fe49f-9024-4f7e-b023-df55a3aab5c1:2026-10-09:2026-10-12',
          guests: { number_of_adults: 2, number_of_rooms: 1, children: [5] },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Detalles de la orden previsualizada y precios finales', type: OrderPreviewResponseDto })
  @ApiResponse(respuestaProblema(400, 'Petición inválida (incluye huéspedes que no caben en la habitación)'))
  @ApiResponse(respuestaProblema(404, 'El alojamiento o la habitación no existen (no está definido en el contrato)'))
  @ApiResponse(respuestaProblema(409, 'ROOM_NO_LONGER_AVAILABLE: sin cupos suficientes (no está definido en el contrato)'))
  previewOrder(@Body() previewRequest: OrderPreviewRequestDto) {
    return this.ordenesService.preview(previewRequest);
  }

  @Post('orders/create')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(ProblemDetailsFilter)
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['alojamientos:book'])
  @ApiOperation({
    summary: 'Crear reserva de alojamiento',
    description:
      'En una transacción: bloquea las noches, verifica cupos y precio, descuenta cupos, crea la orden (CONFIRMED, pago simulado) ' +
      'y guarda la Idempotency-Key. Misma clave y mismo cuerpo: devuelve la respuesta guardada sin crear otra orden. ' +
      'Misma clave con otro cuerpo: 422. PENDIENTE: el contrato exige OAuth2 (alojamientos:book).',
  })
  @ApiHeader(CABECERA_IDEMPOTENCIA)
  @ApiBody({
    type: OrderCreateRequestDto,
    examples: {
      'Crear con una vista previa vigente': {
        value: {
          order_preview_id: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
          payment_reference: 'PAY-SIM-0001',
          customer_details: { first_name: 'Ana', last_name: 'Pérez', email: 'ana.perez@example.com' },
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Orden creada exitosamente', type: OrderDetailDto })
  @ApiResponse(respuestaProblema(400, 'Petición inválida, Idempotency-Key ausente o mal formada, vista previa inexistente o expirada'))
  @ApiResponse(respuestaProblema(409, 'ROOM_NO_LONGER_AVAILABLE (otra reserva tomó los cupos) o PRICE_CHANGED'))
  @ApiResponse(respuestaProblema(422, 'La Idempotency-Key ya se usó con un cuerpo distinto (no está definido en el contrato)'))
  async createOrder(
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Body() createRequest: OrderCreateRequestDto,
  ) {
    const clave = validarIdempotencyKey(idempotencyKey);
    const respuesta = await this.ordenesService.crear(clave, createRequest);
    return respuesta.body; // siempre 201: solo se guardan (y repiten) creaciones exitosas
  }

  @Get('orders/:orderId')
  @UseFilters(ProblemDetailsFilter)
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['alojamientos:read'])
  @ApiOperation({
    summary: 'Obtener detalles de la orden',
    description: 'Devuelve la orden con su estado, fechas, habitación y enlaces HATEOAS. PENDIENTE: el contrato exige OAuth2 (alojamientos:read).',
  })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid', example: '9a1f3c52-7d2e-4b8a-9f61-3c5d7e9b1a24' })
  @ApiResponse({ status: 200, description: 'Detalles completos de la orden', type: OrderDetailDto })
  @ApiResponse(respuestaProblema(400, 'orderId no es un UUID'))
  @ApiResponse(respuestaProblema(404, 'La orden no existe'))
  getOrder(@Param('orderId', uuidDeOrden()) orderId: string) {
    return this.ordenesService.obtener(orderId);
  }

  @Post('orders/:orderId/modify')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['alojamientos:book'])
  @ApiOperation({
    summary: 'Modificar una orden existente',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe OrderModifyRequest del contrato. Exige Idempotency-Key. Pide el scope OAuth2 alojamientos:book (pendiente).',
  })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 para evitar modificaciones duplicadas' })
  @ApiResponse({ status: 200, description: 'Orden modificada' })
  @ApiResponse({ status: 409, description: 'Conflicto' })
  @UseGuards(IdempotencyKeyGuard)
  modifyOrder(
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() modifyRequest: any,
  ) {
    return this.alojamientosService.modifyOrder(orderId, modifyRequest);
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseFilters(ProblemDetailsFilter)
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['alojamientos:cancel'])
  @ApiOperation({
    summary: 'Cancelar una orden',
    description:
      'En una transacción: pasa la orden a CANCELLED y devuelve los cupos de cada noche. Si ya estaba cancelada, ' +
      'devuelve la orden tal cual (200) sin devolver cupos otra vez. La Idempotency-Key es obligatoria pero no se guarda: ' +
      'la cancelación ya es idempotente por el estado. PENDIENTE: el contrato exige OAuth2 (alojamientos:cancel).',
  })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid', example: '9a1f3c52-7d2e-4b8a-9f61-3c5d7e9b1a24' })
  @ApiHeader(CABECERA_IDEMPOTENCIA)
  @ApiResponse({ status: 200, description: 'Cancelación procesada: devuelve la orden', type: OrderDetailDto })
  @ApiResponse(respuestaProblema(400, 'orderId no es un UUID o falta la Idempotency-Key'))
  @ApiResponse(respuestaProblema(404, 'La orden no existe (no está definido en el contrato)'))
  @ApiResponse(respuestaProblema(409, 'Conflicto (definido en el contrato; hoy no se produce)'))
  cancelOrder(
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Param('orderId', uuidDeOrden()) orderId: string,
  ) {
    validarIdempotencyKey(idempotencyKey);
    return this.ordenesService.cancelar(orderId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Webhooks
  // ══════════════════════════════════════════════════════════════════════════

  @Get('webhooks')
  @ApiTags('Webhooks')
  @ApiSecurity('OAuth2Security', ['alojamientos:webhooks'])
  @ApiOperation({
    summary: 'Listar suscripciones',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Pide el scope OAuth2 alojamientos:webhooks (pendiente).',
  })
  @ApiResponse({ status: 200, description: 'Suscripciones activas' })
  listWebhooks() {
    return this.alojamientosService.listWebhooks();
  }

  @Post('webhooks')
  @ApiTags('Webhooks')
  @ApiSecurity('OAuth2Security', ['alojamientos:webhooks'])
  @ApiOperation({
    summary: 'Registrar webhook',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe WebhookSubscription del contrato. Pide el scope OAuth2 alojamientos:webhooks (pendiente).',
  })
  @ApiResponse({ status: 201, description: 'Webhook registrado' })
  @HttpCode(HttpStatus.CREATED)
  createWebhook(@Body() webhookSubscription: any) {
    return this.alojamientosService.createWebhook(webhookSubscription);
  }

  @Delete('webhooks/:id')
  @ApiTags('Webhooks')
  @ApiSecurity('OAuth2Security', ['alojamientos:webhooks'])
  @ApiOperation({
    summary: 'Eliminar suscripción',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Pide el scope OAuth2 alojamientos:webhooks (pendiente).',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Eliminado' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.alojamientosService.deleteWebhook(id);
  }
}
