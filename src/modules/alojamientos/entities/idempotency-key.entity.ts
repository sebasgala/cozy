import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Guarda la respuesta de cada Idempotency-Key para devolver lo mismo si el cliente reintenta.
@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn({ type: 'uuid' })
  key: string;

  @Column({ type: 'varchar', length: 255 })
  endpoint: string;

  @Column({ type: 'int' })
  statusCode: number;

  @Column({ type: 'jsonb', nullable: true })
  responseBody: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
