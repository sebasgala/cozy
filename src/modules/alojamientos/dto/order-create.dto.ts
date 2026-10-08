import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsEmail, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';

// `customer_details` del contrato. Sus campos son obligatorios aquí (en el contrato no lo son)
// porque una reserva sin nombre ni correo del cliente no sirve.
export class CustomerDetailsDto {
  @ApiProperty({ example: 'Ana', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  first_name: string;

  @ApiProperty({ example: 'Pérez', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  last_name: string;

  @ApiProperty({ example: 'ana.perez@example.com', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email: string;
}

// Esquema `OrderCreateRequest` del contrato.
export class OrderCreateRequestDto {
  @ApiProperty({ description: 'Id devuelto por /orders/preview (vence a los 15 minutos)', example: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d' })
  @IsString()
  @IsNotEmpty()
  order_preview_id: string;

  @ApiProperty({ description: 'Referencia del pago (simulado: se guarda, no se cobra)', example: 'PAY-SIM-0001', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  payment_reference: string;

  @ApiProperty({ type: () => CustomerDetailsDto })
  @IsDefined({ message: 'customer_details es obligatorio' })
  @ValidateNested()
  @Type(() => CustomerDetailsDto)
  customer_details: CustomerDetailsDto;
}
