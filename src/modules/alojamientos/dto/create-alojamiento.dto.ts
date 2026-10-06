import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// `destino` y `habitaciones` no se aceptan: destino se copia del nombre de la ciudad
// y habitaciones se calcula contando las filas de la tabla habitaciones.
export class CreateAlojamientoDto {
  @ApiProperty({ description: 'Nombre del alojamiento', example: 'Resort Las Palmas', maxLength: 255 })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  nombre: string;

  @ApiProperty({ description: 'Identificador de la ciudad (debe existir en /ciudades)', example: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  ciudadId: number;

  @ApiPropertyOptional({ description: 'Descripción del alojamiento', example: 'Hotel frente al mar con vista panorámica.' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({
    description: 'Moneda ISO 4217 (3 letras; se guarda en mayúsculas). Por defecto USD',
    example: 'USD',
    pattern: '^[A-Z]{3}$',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'moneda debe ser un código ISO de 3 letras (ej. "USD")' })
  moneda?: string;

  @ApiProperty({ description: 'Precio por noche (máximo 2 decimales)', example: 120.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(99999999.99)
  precioPorNoche: number;

  @ApiProperty({ description: 'Capacidad de adultos permitida', example: 2 })
  @IsInt()
  @Min(1)
  @Max(100)
  capacidadAdultos: number;

  @ApiProperty({ description: 'Capacidad de niños permitida', example: 1 })
  @IsInt()
  @Min(0)
  @Max(100)
  capacidadNinos: number;

  @ApiProperty({ description: 'Indica si el alojamiento tiene piscina', example: true })
  @IsBoolean()
  tienePiscina: boolean;

  @ApiPropertyOptional({
    description: 'URLs de las fotos',
    type: [String],
    example: ['https://picsum.photos/seed/hotel-1/800/600'],
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  fotos?: string[];

  @ApiPropertyOptional({ description: 'Facilidades que ofrece', type: [String], example: ['wifi', 'piscina', 'desayuno'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  facilidades?: string[];

  @ApiPropertyOptional({
    description: 'Políticas del alojamiento (objeto libre)',
    type: 'object',
    additionalProperties: true,
    example: { checkin: '15:00', checkout: '12:00', mascotas: false },
  })
  @IsOptional()
  @IsObject()
  politicas?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Estado del alojamiento. Por defecto true. Permite reactivar uno dado de baja (DELETE)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
