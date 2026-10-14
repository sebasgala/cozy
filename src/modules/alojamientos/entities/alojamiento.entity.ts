import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { Ciudad } from './ciudad.entity';
import { Usuario } from './usuario.entity';

@Entity('alojamientos')
@Check('CHK_alojamientos_precio_por_noche', '"precioPorNoche" >= 0')
export class Alojamiento {
  // Entero autoincremental: el contrato define accommodation como integer
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  nombre: string;

  @Column({ type: 'varchar', length: 255 })
  destino: string;

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  precioPorNoche: number;

  @Column({ type: 'int' })
  capacidadAdultos: number;

  @Column({ type: 'int' })
  capacidadNinos: number;

  @Column({ type: 'int' })
  habitaciones: number;

  @Column({ type: 'boolean' })
  tienePiscina: boolean;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  // Código ISO 4217 (ej. 'USD')
  @Column({ type: 'varchar', length: 3, default: 'USD' })
  moneda: string;

  @Index('IX_alojamientos_ciudadId')
  @Column({ type: 'int', nullable: true })
  ciudadId: number | null;

  @ManyToOne(() => Ciudad, { nullable: true })
  @JoinColumn({ name: 'ciudadId' })
  ciudad: Ciudad | null;

  // Administrador dueño del alojamiento. Null = sin dueño (solo lo ve el superadmin).
  @Index('IX_alojamientos_propietarioId')
  @Column({ type: 'uuid', nullable: true })
  propietarioId: string | null;

  @ManyToOne(() => Usuario, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'propietarioId' })
  propietario: Usuario | null;

  @Column({ type: 'jsonb', nullable: true })
  fotos: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  facilidades: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  politicas: Record<string, any> | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
