import {
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

// Mismos valores que el enum status de OrderDetail en el contrato.
export enum OrdenStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

// Su id es el order_id del contrato.
@Entity('ordenes')
export class Orden {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Código de confirmación visible para el cliente (equivale al PNR)
  @Column({ type: 'varchar', length: 50, unique: true })
  locator: string;

  @Column({ type: 'enum', enum: OrdenStatus, default: OrdenStatus.PENDING })
  status: OrdenStatus;

  @Column({ type: 'int' })
  alojamientoId: number;

  @ManyToOne(() => Alojamiento, { nullable: false })
  @JoinColumn({ name: 'alojamientoId' })
  alojamiento: Alojamiento;

  @Column({ type: 'uuid' })
  habitacionId: string;

  @ManyToOne(() => Habitacion, { nullable: false })
  @JoinColumn({ name: 'habitacionId' })
  habitacion: Habitacion;

  @Column({ type: 'jsonb' })
  guests: Record<string, any>;

  @Column({ type: 'date', nullable: true })
  checkin: string | null;

  @Column({ type: 'date', nullable: true })
  checkout: string | null;

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

  // Sub del token JWT del dueño de la reserva
  @Index()
  @Column({ type: 'varchar', length: 255 })
  ownerId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
