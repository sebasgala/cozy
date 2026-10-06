import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { Habitacion } from './habitacion.entity';

// Una fila por habitación y por día: cuántos cupos quedan y a qué precio.
@Entity('disponibilidad_diaria')
export class DisponibilidadDiaria {
  @PrimaryColumn({ type: 'uuid' })
  habitacionId: string;

  // Fecha sin hora, formato 'YYYY-MM-DD'
  @PrimaryColumn({ type: 'date' })
  fecha: string;

  @ManyToOne(() => Habitacion, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'habitacionId' })
  habitacion: Habitacion;

  @Column({ type: 'int' })
  cupos: number;

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  precio: number;
}
