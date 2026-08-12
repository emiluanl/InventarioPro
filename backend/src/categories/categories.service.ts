// =============================================================================
// CategoriesService - gestiona categorías del sistema y personalizadas
// =============================================================================

import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, Category } from '../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve las categorías del sistema (user_id null) + las del usuario. */
  async listForUser(userId: string): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: {
        OR: [{ user_id: null }, { user_id: userId }],
      },
      orderBy: [{ user_id: 'asc' }, { nombre: 'asc' }],
    });
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

    return this.prisma.category.create({
      data: {
        user_id: userId,
        nombre: dto.nombre,
        icono: dto.icono ?? null,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.assertOwned(userId, id);
    return this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined && { nombre: dto.nombre }),
        ...(dto.icono !== undefined && { icono: dto.icono }),
      },
    });
  }

  async remove(userId: string, id: string): Promise<{ message: string }> {
    await this.assertOwned(userId, id);
    await this.prisma.category.delete({ where: { id } });
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
