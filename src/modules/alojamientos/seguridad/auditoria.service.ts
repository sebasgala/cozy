import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditoriaCambio } from '../entities/auditoria-cambio.entity';

export interface RegistroAuditoria {
  usuarioId: string | null;
  accion: string;
  entidad: string;
  entidadId: string | number;
  antes?: Record<string, any> | null;
  despues?: Record<string, any> | null;
}

// Escribe en auditoria_cambios. Siempre recibe el EntityManager de la transacción del cambio, así la fila
// y el cambio se guardan juntos o no se guarda ninguno.
@Injectable()
export class AuditoriaService {
  async registrar(manager: EntityManager, registro: RegistroAuditoria): Promise<void> {
    await manager.insert(AuditoriaCambio, {
      usuarioId: registro.usuarioId,
      accion: registro.accion,
      entidad: registro.entidad,
      entidadId: String(registro.entidadId),
      // jsonb: el tipo de insert() de TypeORM no acepta objetos con tipo propio en esta columna.
      antes: (registro.antes ?? null) as any,
      despues: (registro.despues ?? null) as any,
    });
  }
}
