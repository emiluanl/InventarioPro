// =============================================================================
// CategoriesService - gestiona categorías del sistema y personalizadas
// =============================================================================

import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, Category } from '../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';

export interface CreateCategoryDto {
  nombre: string;
  icono?: string;
}

export interface UpdateCategoryDto {
  nombre?: string;
  icono?: string;
}

@Injectable()
export class CategoriesService {
  // TTL del caché de categorías: son casi estáticas, 5 min es seguro.
  private static readonly CACHE_TTL = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Devuelve las categorías del sistema (user_id null) + las del usuario. */
  async listForUser(userId: string): Promise<Category[]> {
    const key = `cache:categories:${userId}`;

    const cached = await this.redis.get(key);
    if (cached) {
      return JSON.parse(cached) as Category[];
    }

    const categories = await this.prisma.category.findMany({
      where: {
        OR: [{ user_id: null }, { user_id: userId }],
      },
      orderBy: [{ user_id: 'asc' }, { nombre: 'asc' }],
    });

    // RedisService.get/set son no-op si Redis no está disponible: en ese caso
    // el caché simplemente no aplica y cada llamada va a la BD.
    await this.redis.set(key, JSON.stringify(categories), CategoriesService.CACHE_TTL);
    return categories;
  }

  /** Invalida el caché de categorías del usuario (tras crear/editar/borrar). */
  private async invalidateCache(userId: string): Promise<void> {
    await this.redis.del(`cache:categories:${userId}`);
  }

  /** Solo las categorías personalizadas del usuario. */
  async listOwn(userId: string): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { user_id: userId },
      orderBy: { nombre: 'asc' },
    });
  }

  async create(userId: string, dto: CreateCategoryDto): Promise<Category> {
    const existing = await this.prisma.category.findFirst({
      where: { user_id: userId, nombre: dto.nombre },
    });
    if (existing) {
      throw new ConflictException('Ya tienes una categoría con ese nombre.');
    }

    const category = await this.prisma.category.create({
      data: {
        user_id: userId,
        nombre: dto.nombre,
        icono: dto.icono ?? null,
      },
    });
    await this.invalidateCache(userId);
    return category;
  }

  async update(userId: string, id: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.assertOwned(userId, id);
    const category = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre }),
        ...(dto.icono !== undefined && { icono: dto.icono }),
      },
    });
    await this.invalidateCache(userId);
    return category;
  }

  async remove(userId: string, id: string): Promise<{ message: string }> {
    await this.assertOwned(userId, id);
    await this.prisma.category.delete({ where: { id } });
    await this.invalidateCache(userId);
    return { message: 'Categoría eliminada.' };
  }

  /** Categoría del sistema (no del usuario): cualquiera puede leerlas. */
  async seedSystemCategories(
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const systemCategories = [
      { nombre: 'Electrónica', icono: 'cpu' },
      { nombre: 'Electrodomésticos', icono: 'home' },
      { nombre: 'Muebles', icono: 'sofa' },
      { nombre: 'Ropa y calzado', icono: 'shirt' },
      { nombre: 'Herramientas', icono: 'wrench' },
      { nombre: 'Hogar y cocina', icono: 'utensils' },
      { nombre: 'Deportes', icono: 'dumbbell' },
      { nombre: 'Libros y música', icono: 'book' },
      { nombre: 'Joyería y accesorios', icono: 'gem' },
      { nombre: 'Otros', icono: 'package' },
    ];

    for (const cat of systemCategories) {
      await tx.category.upsert({
        where: { id: `system-${cat.nombre.toLowerCase().replace(/\s+/g, '-')}` },
        create: {
          id: `system-${cat.nombre.toLowerCase().replace(/\s+/g, '-')}`,
          nombre: cat.nombre,
          icono: cat.icono,
          user_id: null,
        },
        update: {},
      });
    }
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const cat = await this.prisma.category.findFirst({
      where: { id, user_id: userId },
    });
    if (!cat) {
      throw new NotFoundException('Categoría no encontrada.');
    }
  }
}
