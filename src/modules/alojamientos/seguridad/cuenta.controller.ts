import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConsultarReservaDto, FiltroReservasQueryDto, ReservasPaginadasDto } from '../dto/admin/reserva-cuenta.dto';
import { UsuarioResponseDto } from '../dto/auth/auth.dto';
import { OrderDetailDto } from '../dto/order-detail.dto';
import { Usuario } from '../entities/usuario.entity';
import { OrdenesService } from '../ordenes.service';
import { ProblemDetailsFilter } from '../problems/problem-details.filter';
import { respuestaProblema } from '../problems/respuestas-swagger';
import { validacionAdmin } from '../problems/validacion.pipes';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LimiteIntentosPorIpGuard } from './limite-intentos.guard';
import { UsuarioActual } from './roles.decorator';

// Cuenta del cliente. Rutas internas (no son parte del contrato).
@ApiTags('Interno - Cuenta')
@UsePipes(validacionAdmin())
@UseFilters(ProblemDetailsFilter)
@Controller('cuenta')
export class CuentaController {
  constructor(
    private readonly authService: AuthService,
    private readonly ordenesService: OrdenesService,
  ) {}

  @Get('perfil')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Mi perfil' })
  @ApiResponse({ status: 200, description: 'Datos de mi cuenta', type: UsuarioResponseDto })
  @ApiResponse(respuestaProblema(401, 'UNAUTHORIZED: falta el token o no es válido'))
  perfil(@UsuarioActual() usuario: Usuario) {
    return this.authService.aRespuesta(usuario);
  }

  @Get('reservas')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Mis reservas',
    description: 'Las órdenes hechas con mi sesión iniciada (clienteId = yo), más recientes primero. Filtro opcional por estado.',
  })
  @ApiResponse({ status: 200, description: 'Página de mis reservas', type: ReservasPaginadasDto })
  @ApiResponse(respuestaProblema(400, 'Filtros inválidos'))
  @ApiResponse(respuestaProblema(401, 'UNAUTHORIZED: falta el token o no es válido'))
  reservas(@Query() filtro: FiltroReservasQueryDto, @UsuarioActual() usuario: Usuario) {
    return this.ordenesService.listarDeCliente(usuario.id, filtro.estado, filtro.page ?? 1, filtro.limit ?? 10);
  }

  @Post('consultar-reserva')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LimiteIntentosPorIpGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Consultar una reserva hecha sin cuenta',
    description:
      'Localizador + correo con el que se reservó. Devuelve lo mismo que GET /orders/{id}. Si el localizador existe pero el ' +
      'correo no coincide, responde 404 igual que si no existiera. Máximo 10 intentos por minuto por IP.',
  })
  @ApiResponse({ status: 200, description: 'Detalle de la reserva', type: OrderDetailDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: no hay una reserva con ese localizador y correo'))
  @ApiResponse(respuestaProblema(429, 'RATE_LIMIT_EXCEEDED: demasiados intentos; cabecera Retry-After'))
  consultarReserva(@Body() dto: ConsultarReservaDto) {
    return this.ordenesService.consultarPorLocalizador(dto.localizador, dto.correo);
  }
}
