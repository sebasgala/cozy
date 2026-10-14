import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Res, UseFilters, UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AlojamientosAdminService } from './alojamientos-admin.service';
import { CreateAlojamientoDto } from '../dto/create-alojamiento.dto';
import { UpdateAlojamientoDto } from '../dto/update-alojamiento.dto';
import { FiltroAlojamientosQueryDto } from '../dto/filtro-alojamientos-query.dto';
import { FiltroHabitacionesQueryDto } from '../dto/admin/habitacion-admin.dto';
import { AlojamientoResponseDto, PaginatedAlojamientosResponseDto } from '../dto/alojamiento-response.dto';
import { ProblemDetailsFilter } from '../problems/problem-details.filter';
import { respuestaProblema } from '../problems/respuestas-swagger';
import { idEntero, validacionAdmin } from '../problems/validacion.pipes';

// ─────────────────────────────────────────────────────────────────────────────
// CRUD de administración de alojamientos (/api/v1/admin/alojamientos).
// Es APARTE del contrato alojamientos-openapi.yaml: no usa sus rutas ni sus esquemas.
//
// PENDIENTE (paso 8): autenticación y roles. Estas rutas son públicas por ahora; la verificación de que
// el alojamiento pertenezca al administrador pasa por AccesoAdminService.
//
// Orden de rutas: las fijas (POST / y GET /) van antes de las rutas con :id.
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Interno - Admin')
@UsePipes(validacionAdmin())
@UseFilters(ProblemDetailsFilter)
@Controller('admin/alojamientos')
export class AlojamientosAdminController {
  constructor(private readonly alojamientosAdminService: AlojamientosAdminService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un alojamiento' })
  @ApiResponse({ status: 201, description: 'Alojamiento creado. Devuelve la cabecera Location.', type: AlojamientoResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos, campos no permitidos o ciudadId inexistente'))
  async crear(@Body() dto: CreateAlojamientoDto, @Res({ passthrough: true }) res: Response) {
    const nuevo = await this.alojamientosAdminService.crear(dto);
    res.setHeader('Location', `/api/v1/admin/alojamientos/${nuevo.id}`);
    return nuevo;
  }

  @Get()
  @ApiOperation({
    summary: 'Listar alojamientos (paginado, con filtros opcionales)',
    description: '`habitaciones` cuenta solo las activas; incluirInactivas=true cuenta todas.',
  })
  @ApiResponse({ status: 200, description: 'Página de alojamientos, incluidos los dados de baja si no se filtra por activo.', type: PaginatedAlojamientosResponseDto })
  @ApiResponse(respuestaProblema(400, 'Parámetros de consulta inválidos'))
  listar(@Query() query: FiltroAlojamientosQueryDto) {
    return this.alojamientosAdminService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener un alojamiento por su id (también si está dado de baja)',
    description: '`habitaciones` cuenta solo las activas; incluirInactivas=true cuenta todas.',
  })
  @ApiParam({ name: 'id', type: 'integer', description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 200, description: 'Detalle del alojamiento.', type: AlojamientoResponseDto })
  @ApiResponse(respuestaProblema(400, 'El id no es un entero'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe'))
  obtener(@Param('id', idEntero('id')) id: number, @Query() conteo: FiltroHabitacionesQueryDto) {
    return this.alojamientosAdminService.findOne(id, conteo.incluirInactivas);
  }

  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reemplazar completamente un alojamiento' })
  @ApiParam({ name: 'id', type: 'integer', description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 204, description: 'Alojamiento reemplazado.' })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos, campos no permitidos o ciudadId inexistente'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe'))
  async reemplazar(@Param('id', idEntero('id')) id: number, @Body() dto: CreateAlojamientoDto) {
    await this.alojamientosAdminService.reemplazar(id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar parcialmente un alojamiento' })
  @ApiParam({ name: 'id', type: 'integer', description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 200, description: 'Alojamiento actualizado.', type: AlojamientoResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos, campos no permitidos o ciudadId inexistente'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe'))
  actualizar(@Param('id', idEntero('id')) id: number, @Body() dto: UpdateAlojamientoDto) {
    return this.alojamientosAdminService.actualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Dar de baja un alojamiento (borrado lógico: activo = false)' })
  @ApiParam({ name: 'id', type: 'integer', description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 204, description: 'Alojamiento dado de baja. La fila no se elimina.' })
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe'))
  async eliminar(@Param('id', idEntero('id')) id: number) {
    await this.alojamientosAdminService.desactivar(id);
  }
}
