import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query, Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AlojamientosAdminService } from './alojamientos-admin.service';
import { CreateAlojamientoDto } from './dto/create-alojamiento.dto';
import { UpdateAlojamientoDto } from './dto/update-alojamiento.dto';
import { FiltroAlojamientosQueryDto } from './dto/filtro-alojamientos-query.dto';
import { AlojamientoResponseDto, PaginatedAlojamientosResponseDto } from './dto/alojamiento-response.dto';

// ─────────────────────────────────────────────────────────────────────────────
// CRUD de administración de alojamientos (/api/v1/alojamientos).
// Es APARTE del contrato alojamientos-openapi.yaml: no usa sus rutas ni sus esquemas.
//
// PENDIENTE: autenticación y roles. Estas rutas son públicas por ahora; cuando exista
// el módulo de seguridad (JWT) deben exigir un rol de administrador.
//
// Orden de rutas: las fijas (POST / y GET /) van antes de las rutas con :id.
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Interno - Admin')
@Controller('alojamientos')
export class AlojamientosAdminController {
  constructor(private readonly alojamientosAdminService: AlojamientosAdminService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un alojamiento' })
  @ApiResponse({ status: 201, description: 'Alojamiento creado. Devuelve la cabecera Location.', type: AlojamientoResponseDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos, campos no permitidos o ciudadId inexistente.' })
  async crear(@Body() dto: CreateAlojamientoDto, @Res({ passthrough: true }) res: Response) {
    const nuevo = await this.alojamientosAdminService.crear(dto);
    res.setHeader('Location', `/api/v1/alojamientos/${nuevo.id}`);
    return nuevo;
  }

  @Get()
  @ApiOperation({ summary: 'Listar alojamientos (paginado, con filtros opcionales)' })
  @ApiResponse({ status: 200, description: 'Página de alojamientos, incluidos los dados de baja si no se filtra por activo.', type: PaginatedAlojamientosResponseDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos.' })
  listar(@Query() query: FiltroAlojamientosQueryDto) {
    return this.alojamientosAdminService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un alojamiento por su id (también si está dado de baja)' })
  @ApiParam({ name: 'id', type: Number, description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 200, description: 'Detalle del alojamiento.', type: AlojamientoResponseDto })
  @ApiResponse({ status: 400, description: 'El id no es un entero.' })
  @ApiResponse({ status: 404, description: 'El alojamiento no existe.' })
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.alojamientosAdminService.findOne(id);
  }

  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reemplazar completamente un alojamiento' })
  @ApiParam({ name: 'id', type: Number, description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 204, description: 'Alojamiento reemplazado.' })
  @ApiResponse({ status: 400, description: 'Datos inválidos, campos no permitidos o ciudadId inexistente.' })
  @ApiResponse({ status: 404, description: 'El alojamiento no existe.' })
  async reemplazar(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateAlojamientoDto) {
    await this.alojamientosAdminService.reemplazar(id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar parcialmente un alojamiento' })
  @ApiParam({ name: 'id', type: Number, description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 200, description: 'Alojamiento actualizado.', type: AlojamientoResponseDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos, campos no permitidos o ciudadId inexistente.' })
  @ApiResponse({ status: 404, description: 'El alojamiento no existe.' })
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAlojamientoDto) {
    return this.alojamientosAdminService.actualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Dar de baja un alojamiento (borrado lógico: activo = false)' })
  @ApiParam({ name: 'id', type: Number, description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 204, description: 'Alojamiento dado de baja. La fila no se elimina.' })
  @ApiResponse({ status: 404, description: 'El alojamiento no existe.' })
  async eliminar(@Param('id', ParseIntPipe) id: number) {
    await this.alojamientosAdminService.desactivar(id);
  }
}
