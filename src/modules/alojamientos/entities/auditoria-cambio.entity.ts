import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Usuario } from './usuario.entity';

// Una fila por cada cambio de datos hecho por un usuario de administración. Se escribe en la misma
// transacción que el cambio: si el cambio se deshace, la fila también.
@Entity('auditoria_cambios')
@Index('IX_auditoria_entidad', ['entidad', 'entidadId'])
export class AuditoriaCambio {
  // bigint: TypeORM lo entrega como texto.
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('IX_auditoria_usuarioId')
  @Column({ type: 'uuid', nullable: true })
  usuarioId: string | null;

  @ManyToOne(() => Usuario, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'usuarioId' })
  usuario: Usuario | null;

  // p. ej. 'crear', 'actualizar', 'desactivar', 'editar_disponibilidad', 'aprobar', 'cancelar'
  @Column({ type: 'varchar', length: 60 })
  accion: string;

  // p. ej. 'habitacion', 'alojamiento', 'disponibilidad', 'usuario', 'orden', 'ciudad'
  @Column({ type: 'varchar', length: 60 })
  entidad: string;

  @Column({ type: 'varchar', length: 120 })
  entidadId: string;

  @Column({ type: 'jsonb', nullable: true })
  antes: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  despues: Record<string, any> | null;

  @Index('IX_auditoria_createdAt')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
