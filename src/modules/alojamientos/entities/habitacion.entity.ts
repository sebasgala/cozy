import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { Alojamiento } from './alojamiento.entity';

// Es el "product" del contrato: su id (UUID) viaja como product_id (texto).
@Entity('habitaciones')
export class Habitacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  alojamientoId: number;

  @ManyToOne(() => Alojamiento, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'alojamientoId' })
  alojamiento: Alojamiento;

  @Column({ type: 'varchar', length: 255 })
  nombre: string;

  @Column({ type: 'varchar', length: 100 })
  tipo: string;

  @Column({ type: 'int' })
  capacidadAdultos: number;

  @Column({ type: 'int' })
  capacidadNinos: number;

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  precioBase: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mealPlan: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  cancellationType: string | null;
}
