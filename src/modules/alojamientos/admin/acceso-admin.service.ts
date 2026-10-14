import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alojamiento } from '../entities/alojamiento.entity';
import { Habitacion } from '../entities/habitacion.entity';
import { ID_MAXIMO, esUuid } from '../alojamientos-consulta.utils';
import { RecursoNoEncontradoException } from '../problems/problem-details.exceptions';

// PUNTO ÚNICO de acceso del admin a un alojamiento (y, a través de él, a sus habitaciones y disponibilidad).
// Todas las rutas de /admin que trabajan sobre un alojamiento existente pasan por aquí.
//
// PENDIENTE (paso 8): recibir el usuario autenticado y comprobar en `verificarPropietario` que el
// alojamiento le pertenezca (alojamiento.propietarioId === usuario.id) o que tenga rol SUPERADMIN.
// Hoy no hay login: cualquiera puede administrar.
@Injectable()
export class AccesoAdminService {
  constructor(
    @InjectRepository(Alojamiento)
    private readonly alojamientosRepository: Repository<Alojamiento>,
    @InjectRepository(Habitacion)
    private readonly habitacionesRepository: Repository<Habitacion>,
  ) {}

  // Alojamiento administrable (activo o dado de baja: el admin también ve los inactivos).
  async alojamiento(id: number): Promise<Alojamiento> {
    // Un id fuera del rango de integer haría fallar a PostgreSQL (500); no puede existir.
    const alojamiento =
      id >= 1 && id <= ID_MAXIMO
        ? await this.alojamientosRepository.findOne({ where: { id }, relations: { ciudad: true } })
        : null;
    if (!alojamiento) throw this.noEncontrado(`Alojamiento ${id} no existe`, 'alojamientoId');
    this.verificarPropietario(alojamiento);
    return alojamiento;
  }

  // Habitación administrable (activa o no). El permiso se decide por su alojamiento.
  async habitacion(id: string): Promise<Habitacion> {
    const habitacion = esUuid(id)
      ? await this.habitacionesRepository.findOne({ where: { id }, relations: { alojamiento: true } })
      : null;
    if (!habitacion) throw this.noEncontrado(`Habitación ${id} no existe`, 'habitacionId');
    this.verificarPropietario(habitacion.alojamiento);
    return habitacion;
  }

  // Paso 8: aquí se lanzará 403 (o 404, para no revelar que existe) si el usuario no es el propietario.
  private verificarPropietario(alojamiento: Alojamiento): void {
    void alojamiento;
  }

  private noEncontrado(detalle: string, parametro: string): RecursoNoEncontradoException {
    return new RecursoNoEncontradoException(detalle, [{ name: parametro, reason: detalle }]);
  }
}
