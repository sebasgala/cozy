import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CiudadesService } from './ciudades.service';
import { CreateCiudadDto } from './dto/create-ciudad.dto';
import { CiudadResponseDto } from './dto/ciudad-response.dto';

// Ciudades mínimas para poder elegir ciudadId al crear alojamientos.
// PENDIENTE: autenticación y roles (ver AlojamientosAdminController).
@ApiTags('Administración - Ciudades')
@Controller('ciudades')
export class CiudadesController {
  constructor(private readonly ciudadesService: CiudadesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar ciudades (ordenadas por nombre)' })
  @ApiResponse({ status: 200, description: 'Lista de ciudades.', type: [CiudadResponseDto] })
  listar() {
    return this.ciudadesService.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una ciudad' })
  @ApiResponse({ status: 201, description: 'Ciudad creada.', type: CiudadResponseDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos o campos no permitidos.' })
  @ApiResponse({ status: 409, description: 'Ya existe una ciudad con ese nombre y país.' })
  crear(@Body() dto: CreateCiudadDto) {
    return this.ciudadesService.crear(dto);
  }
}
