import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { Alojamiento } from './alojamiento.entity';
import { Habitacion } from './habitacion.entity';
import { OrdenPreview } from './orden-preview.entity';
import { Usuario } from './usuario.entity';

// Mismos valores que el enum status de OrderDetail en el contrato.
export enum OrdenStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

// Nombres de restricciones que el código necesita reconocer cuando PostgreSQL las reporta.
export const UQ_ORDENES_LOCATOR = 'UQ_e3a1516e13b1a7c08532fc5b167';
export const UQ_ORDENES_PREVIEW = 'UQ_ordenes_previewId';

// Su id es el order_id del contrato.
@Entity('ordenes')
@Check('CHK_ordenes_total', '"totalPrice" >= 0')
@Check('CHK_ordenes_fechas', '"checkout" > "checkin"')
@Check('CHK_ordenes_habitaciones_reservadas', '"habitacionesReservadas" >= 1')
export class Orden {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Código de confirmación visible para el cliente (equivale al PNR)
  @Column({ type: 'varchar', length: 50, unique: true })
  locator: string;

  @Column({ type: 'enum', enum: OrdenStatus, default: OrdenStatus.PENDING })
  status: OrdenStatus;

  @Index('IX_ordenes_alojamientoId')
  @Column({ type: 'int' })
  alojamientoId: number;

  @ManyToOne(() => Alojamiento, { nullable: false })
  @JoinColumn({ name: 'alojamientoId' })
  alojamiento: Alojamiento;

  @Index('IX_ordenes_habitacionId')
  @Column({ type: 'uuid' })
  habitacionId: string;

  @ManyToOne(() => Habitacion, { nullable: false })
  @JoinColumn({ name: 'habitacionId' })
  habitacion: Habitacion;

  // Vista previa de la que salió la orden. Índice único: un preview da una sola orden.
  // Null en órdenes anteriores a esta columna o si el preview se borra (ON DELETE SET NULL).
  @Index(UQ_ORDENES_PREVIEW, { unique: true })
  @Column({ type: 'uuid', nullable: true })
  previewId: string | null;

  @ManyToOne(() => OrdenPreview, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'previewId', foreignKeyConstraintName: 'FK_ordenes_previewId' })
  preview: OrdenPreview | null;

  @Column({ type: 'jsonb' })
  guests: Record<string, any>;

  @Column({ type: 'date' })
  checkin: string;

  @Column({ type: 'date' })
  checkout: string;

  // Cupos que se descontaron de cada noche (= guests.number_of_rooms). La cancelación devuelve
  // exactamente este número, sin depender del JSON de huéspedes.
  @Column({ type: 'int' })
  habitacionesReservadas: number;

  @Column({ type: 'varchar', length: 120 })
  customerFirstName: string;

  @Column({ type: 'varchar', length: 120 })
  customerLastName: string;

  @Column({ type: 'varchar', length: 255 })
  customerEmail: string;

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  totalPrice: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'varchar', length: 255 })
  paymentReference: string;

  // Cliente con cuenta que hizo la compra. Null = compra sin cuenta (o anterior a las cuentas).
  @Index('IX_ordenes_clienteId')
  @Column({ type: 'uuid', nullable: true })
  clienteId: string | null;

  @ManyToOne(() => Usuario, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'clienteId' })
  cliente: Usuario | null;

  @Index('IX_ordenes_createdAt')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
