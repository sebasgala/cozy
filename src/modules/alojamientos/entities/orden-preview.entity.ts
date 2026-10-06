import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { Alojamiento } from './alojamiento.entity';
import { Habitacion } from './habitacion.entity';

// Su id es el order_preview_id del contrato.
@Entity('ordenes_preview')
export class OrdenPreview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  totalPrice: number;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
