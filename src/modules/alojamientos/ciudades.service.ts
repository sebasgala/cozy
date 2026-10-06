import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ciudad } from './entities/ciudad.entity';
import { CreateCiudadDto } from './dto/create-ciudad.dto';

@Injectable()
export class CiudadesService {
  constructor(
    @InjectRepository(Ciudad)
    private readonly ciudadesRepository: Repository<Ciudad>,
  ) {}

  findAll(): Promise<Ciudad[]> {
    return this.ciudadesRepository.find({ order: { nombre: 'ASC', pais: 'ASC' } });
  }

  async crear(dto: CreateCiudadDto): Promise<Ciudad> {
    // La restricción única de la BD distingue mayúsculas; aquí se evita también "quito" vs "Quito".
    const existente = await this.ciudadesRepository
      .createQueryBuilder('c')
      .where('LOWER(c.nombre) = LOWER(:nombre)', { nombre: dto.nombre })
      .andWhere('c.pais = :pais', { pais: dto.pais })
      .getOne();
    if (existente) {
      throw new ConflictException(`La ciudad "${existente.nombre}" (${existente.pais}) ya existe`);
    }
    const nueva = this.ciudadesRepository.create(dto);
    return this.ciudadesRepository.save(nueva);
  }
}
