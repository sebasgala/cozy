import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { ConsultaInvalidaException, InvalidParam, RecursoNoEncontradoException } from './problem-details.exceptions';

const DETALLE_VALIDACION = 'La petición contiene parámetros inválidos';

// Convierte los errores 400 y 404 de una ruta al formato ProblemDetails del contrato
// (application/problem+json). Se aplica con @UseFilters solo en las rutas del contrato,
// así el CRUD de administración conserva el formato de error por defecto de NestJS.
@Catch(BadRequestException, NotFoundException)
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const { detail, invalidParams } = this.interpretar(exception);

    const problema = {
      type: 'about:blank',
      title: status === 404 ? 'No encontrado' : 'Petición inválida',
      status,
      detail,
      // El enum `code` del contrato no tiene un valor para "no encontrado": se usa el más cercano.
      code: 'VALIDATION_FAILED',
      ...(invalidParams.length > 0 && { invalidParams }),
    };

    response.status(status).type('application/problem+json').json(problema);
  }

  private interpretar(exception: HttpException): { detail: string; invalidParams: InvalidParam[] } {
    // Excepciones propias: ya traen el detalle y los parámetros.
    if (exception instanceof ConsultaInvalidaException || exception instanceof RecursoNoEncontradoException) {
      return { detail: this.mensaje(exception), invalidParams: exception.invalidParams };
    }
    // Errores del ValidationPipe global: `message` es una lista de textos de class-validator.
    if (exception instanceof BadRequestException) {
      const respuesta = exception.getResponse() as { message?: string | string[] };
      const mensajes = Array.isArray(respuesta.message) ? respuesta.message : [this.mensaje(exception)];
      return { detail: DETALLE_VALIDACION, invalidParams: this.agruparPorParametro(mensajes) };
    }
    return { detail: this.mensaje(exception), invalidParams: [] };
  }

  private mensaje(exception: HttpException): string {
    const respuesta = exception.getResponse();
    return typeof respuesta === 'string' ? respuesta : String((respuesta as any).message ?? exception.message);
  }

  // class-validator no entrega el nombre del campo por separado: todos sus mensajes lo traen al inicio
  // ("checkin debe ...", "booker.country must be ...") salvo dos formas que se tratan aparte.
  private nombreDelParametro(mensaje: string): string {
    const noPermitido = mensaje.match(/^(.*?)property (\S+) should not exist$/);
    if (noPermitido) return `${noPermitido[1]}${noPermitido[2]}`;
    const cadaValor = mensaje.match(/^(.*?)each value in (\S+) /);
    if (cadaValor) return `${cadaValor[1]}${cadaValor[2]}`;
    return mensaje.split(' ')[0];
  }

  private agruparPorParametro(mensajes: string[]): InvalidParam[] {
    const razones = new Map<string, string[]>();
    for (const mensaje of mensajes) {
      const nombre = this.nombreDelParametro(mensaje);
      razones.set(nombre, [...(razones.get(nombre) ?? []), mensaje]);
    }
    return [...razones.entries()].map(([name, lista]) => ({ name, reason: lista.join('; ') }));
  }
}
