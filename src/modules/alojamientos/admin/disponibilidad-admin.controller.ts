import { Body, Controller, Get, Param, Patch, Query, UseFilters, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  DisponibilidadAdminResponseDto,
  EdicionDisponibilidadResponseDto,
  EditarDiaDto,
  EditarRangoDto,
  RangoFechasQueryDto,
} from '../dto/admin/disponibilidad-admin.dto';
import { ProblemDetailsFilter } from '../problems/problem-details.filter';
import { respuestaProblema } from '../problems/respuestas-swagger';
import { fechaIso, idUuid, validacionAdmin } from '../problems/validacion.pipes';
import { DisponibilidadAdminService } from './disponibilidad-admin.service';

// ─────────────────────────────────────────────────────────────────────────────
// Administración de disponibilidad y precios por fecha (/api/v1/admin/habitaciones/{id}/disponibilidad).
// NO es parte del contrato. PENDIENTE (paso 8): guard de autenticación y rol.
//
// El admin edita cuposTotales (habitaciones que existen); los cupos que quedan se ajustan solos para no
// pisar las reservas. Ver DisponibilidadAdminService.
// ─────────────────────────────────────────────────────────────────────────────

const RESPUESTA_409 = respuestaProblema(409, 'cuposTotales quedaría por debajo de lo ya vendido; invalidParams lista cada fecha. No se guarda nada');

@ApiTags('Interno - Admin')
@UsePipes(validacionAdmin())
@UseFilters(ProblemDetailsFilter)
@Controller('admin/habitaciones/:id/disponibilidad')
export class DisponibilidadAdminController {
  constructor(private readonly disponibilidadAdminService: DisponibilidadAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Listar disponibilidad y precios por rango de fechas', description: 'desde y hasta incluidos, máximo 366 días.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Habitación' })
  @ApiResponse({ status: 200, description: 'Días con fila en el rango', type: DisponibilidadAdminResponseDto })
  @ApiResponse(respuestaProblema(400, 'Fechas inválidas, hasta anterior a desde o más de 366 días'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  listar(@Param('id', idUuid('id')) id: string, @Query() rango: RangoFechasQueryDto) {
    return this.disponibilidadAdminService.listar(id, rango.desde, rango.hasta);
  }

  @Patch()
  @ApiOperation({
    summary: 'Editar un rango de fechas en una sola operación',
    description:
      'Cambia cuposTotales y/o precio de cada día de [desde, hasta] (opcionalmente solo ciertos días de la semana). ' +
      'Todo o nada, en una transacción que bloquea las noches en orden de fecha. Los días que no existen se crean ' +
      '(hacen falta cuposTotales y precio). dryRun=true devuelve lo que cambiaría sin guardar.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Habitación' })
  @ApiResponse({ status: 200, description: 'Cambios aplicados (o que se aplicarían, con dryRun)', type: EdicionDisponibilidadResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos, rango mayor a 366 días o días nuevos sin cuposTotales y precio'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  @ApiResponse(RESPUESTA_409)
  editarRango(@Param('id', idUuid('id')) id: string, @Body() dto: EditarRangoDto) {
    return this.disponibilidadAdminService.editar(id, dto);
  }

  @Patch(':fecha')
  @ApiOperation({
    summary: 'Editar un día',
    description: 'Cambia cuposTotales y/o precio de esa fecha. Si el día no existe, se crea (hacen falta los dos).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Habitación' })
  @ApiParam({ name: 'fecha', format: 'date', example: '2026-10-20' })
  @ApiResponse({ status: 200, description: 'Cambio aplicado (o que se aplicaría, con dryRun)', type: EdicionDisponibilidadResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos o fecha inválidos'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  @ApiResponse(RESPUESTA_409)
  editarDia(@Param('id', idUuid('id')) id: string, @Param('fecha', fechaIso('fecha')) fecha: string, @Body() dto: EditarDiaDto) {
    return this.disponibilidadAdminService.editar(id, { ...dto, desde: fecha, hasta: fecha });
  }
}
