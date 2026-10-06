import { BadRequestException, NotFoundException } from '@nestjs/common';

// Elemento de `invalidParams` del esquema ProblemDetails del contrato.
export interface InvalidParam {
  name: string;
  reason: string;
}

// 400 con la lista de parámetros inválidos ya armada (validaciones que no hace class-validator).
export class ConsultaInvalidaException extends BadRequestException {
  constructor(
    public readonly invalidParams: InvalidParam[],
    detail = 'La petición contiene parámetros inválidos',
  ) {
    super(detail);
  }
}

// 404 para un alojamiento que no existe o está inactivo.
export class RecursoNoEncontradoException extends NotFoundException {
  constructor(
    detail: string,
    public readonly invalidParams: InvalidParam[] = [],
  ) {
    super(detail);
  }
}
