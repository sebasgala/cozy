import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ConsultaInvalidaException, InvalidParam } from './problem-details.exceptions';

// Cada controlador declara su política de validación con @UsePipes (no hay pipe global): un pipe global
// con whitelist quitaría los campos extra antes de que el pipe estricto del admin pudiera rechazarlos.

// Si un campo falla varias reglas a la vez, se informa la más básica: primero "falta", luego "tipo
// incorrecto" y solo después las demás (largo, formato, mínimo...). Así un campo ausente dice "es
// obligatorio" y no cuatro motivos.
const REGLAS_DE_PRESENCIA = ['isDefined', 'isNotEmpty'];
const REGLAS_DE_TIPO = ['isString', 'isInt', 'isNumber', 'isBoolean', 'isArray', 'isObject', 'nestedValidation'];

function motivo(constraints: Record<string, string>): string {
  for (const grupo of [REGLAS_DE_PRESENCIA, REGLAS_DE_TIPO]) {
    const regla = grupo.find((nombre) => constraints[nombre]);
    if (regla) return constraints[regla];
  }
  return Object.values(constraints).join('; ');
}

// Aplana el árbol de errores de class-validator: un elemento por campo, con su ruta completa
// ("customer_details.email", "guests.allocation.0.adults").
function aInvalidParams(errores: ValidationError[], prefijo = ''): InvalidParam[] {
  return errores.flatMap((error) => {
    const name = prefijo ? `${prefijo}.${error.property}` : error.property;
    const propios = error.constraints ? [{ name, reason: motivo(error.constraints) }] : [];
    return [...propios, ...aInvalidParams(error.children ?? [], name)];
  });
}

// Rutas del contrato: los campos extra se ignoran (respuesta oficial de los autores del contrato), pero un
// campo obligatorio ausente o con tipo incorrecto sigue dando 400 en formato ProblemDetails.
export const validacionContrato = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    exceptionFactory: (errores) => new ConsultaInvalidaException(aInvalidParams(errores)),
  });

// Rutas internas de administración: estrictas, un campo que no existe en el DTO da 400 (formato de NestJS).
export const validacionAdmin = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
