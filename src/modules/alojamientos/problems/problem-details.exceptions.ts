import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

// Elemento de `invalidParams` del esquema ProblemDetails del contrato.
export interface InvalidParam {
  name: string;
  reason: string;
}

// Valores del enum `code` de ProblemDetails en el contrato.
export type CodigoProblema =
  | 'VALIDATION_FAILED'
  | 'ROOM_NO_LONGER_AVAILABLE'
  | 'PRICE_CHANGED'
  | 'BOOKING_NOT_CONFIRMED'
  | 'CANCELLATION_NOT_ALLOWED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'PAYMENT_REFERENCE_INVALID'
  | 'PAYMENT_NOT_AUTHORIZED';

// 400 con la lista de parámetros inválidos ya armada (validaciones que no hace class-validator).
export class ConsultaInvalidaException extends BadRequestException {
  constructor(
    public readonly invalidParams: InvalidParam[],
    detail = 'La petición contiene parámetros inválidos',
  ) {
    super(detail);
  }
}

// 404 para un recurso que no existe (o un alojamiento inactivo).
export class RecursoNoEncontradoException extends NotFoundException {
  constructor(
    detail: string,
    public readonly invalidParams: InvalidParam[] = [],
  ) {
    super(detail);
  }
}

// 409 del contrato (ProblemDetails409): conflicto de negocio con su código.
export class ConflictoException extends ConflictException {
  constructor(
    public readonly code: CodigoProblema,
    detail: string,
    public readonly invalidParams: InvalidParam[] = [],
  ) {
    super(detail);
  }
}

// 422: la Idempotency-Key ya se usó con otro cuerpo (el contrato no define este caso).
export class ClaveIdempotenciaReutilizadaException extends UnprocessableEntityException {
  constructor(public readonly invalidParams: InvalidParam[]) {
    super('La Idempotency-Key ya se usó con una petición distinta');
  }
}
