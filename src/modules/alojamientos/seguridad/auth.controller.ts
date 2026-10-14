import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LoginDto, LoginResponseDto, RegistroDto, UsuarioResponseDto } from '../dto/auth/auth.dto';
import { Usuario } from '../entities/usuario.entity';
import { ProblemDetailsFilter } from '../problems/problem-details.filter';
import { respuestaProblema } from '../problems/respuestas-swagger';
import { validacionAdmin } from '../problems/validacion.pipes';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LimiteIntentosGuard } from './limite-intentos.guard';
import { UsuarioActual } from './roles.decorator';

// Registro, login y "quién soy". Rutas internas (no son parte del contrato).
@ApiTags('Interno - Autenticación')
@UsePipes(validacionAdmin())
@UseFilters(ProblemDetailsFilter)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('registro')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear una cuenta',
    description:
      'rol "cliente" (por defecto) queda activo y puede iniciar sesión. rol "administrador" queda pendiente: no puede ' +
      'iniciar sesión (403 ACCOUNT_PENDING) hasta que el superadmin lo apruebe. El superadmin no se registra por aquí.',
  })
  @ApiResponse({ status: 201, description: 'Cuenta creada (sin contraseña ni hash)', type: UsuarioResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos o campos no permitidos'))
  @ApiResponse(respuestaProblema(409, 'Ya existe una cuenta con ese correo'))
  registro(@Body() dto: RegistroDto) {
    return this.authService.registrar(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LimiteIntentosGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Iniciar sesión',
    description:
      'Devuelve un token de acceso de 1 hora. Máximo 5 intentos por minuto por correo e IP (después, 429). ' +
      'Un administrador pendiente da 403 ACCOUNT_PENDING y una cuenta suspendida 403 ACCOUNT_SUSPENDED, pero solo ' +
      'si la contraseña es correcta; con contraseña incorrecta siempre es 401.',
  })
  @ApiResponse({ status: 200, description: 'Sesión iniciada', type: LoginResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos'))
  @ApiResponse(respuestaProblema(401, 'UNAUTHORIZED: correo o contraseña incorrectos'))
  @ApiResponse(respuestaProblema(403, 'ACCOUNT_PENDING o ACCOUNT_SUSPENDED'))
  @ApiResponse(respuestaProblema(429, 'RATE_LIMIT_EXCEEDED: demasiados intentos; cabecera Retry-After'))
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Usuario de la sesión actual' })
  @ApiResponse({ status: 200, description: 'Datos del usuario', type: UsuarioResponseDto })
  @ApiResponse(respuestaProblema(401, 'UNAUTHORIZED: falta el token o no es válido'))
  @ApiResponse(respuestaProblema(403, 'ACCOUNT_PENDING o ACCOUNT_SUSPENDED'))
  me(@UsuarioActual() usuario: Usuario) {
    return this.authService.aRespuesta(usuario);
  }
}
