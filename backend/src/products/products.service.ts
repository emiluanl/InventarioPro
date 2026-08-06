// =============================================================================
// ProductsService - CRUD + búsqueda + filtros + cálculo de tiempo_posesion
// =============================================================================
// Reglas clave:
//   - TODA consulta filtra por user_id del request, NUNCA se devuelve un
//     producto de otro usuario.
//   - El borrado es LÓGICO (deleted_at): las filas se mantienen para auditoría
//     y para conservar las referencias en adjuntos.
//   - El campo "tiempo_posesion" se calcula al vuelo (no se guarda).
// =============================================================================

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma, Product, ProductStatus, PurchaseType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsQueryDto, SortBy, SortOrder } from './dto/products-query.dto';
import {
  calculateOwnershipDuration,
  formatOwnership,
  getWarrantyStatus,
} from '../common/lib/time-ownership';

export interface ProductResponse extends Omit<Product, 'deleted_at'> {
  tiempo_posesion: string;
  warranty_status: 'vigente' | 'por_vencer' | 'vencida' | null;
  days_until_warranty_expires: number | null;
  categoria?: { id: string; nombre: string; icono: string | null } | null;
  attachments_count: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ===========================================================================
  // LIST - paginado, filtrable, buscable, ordenable
  // ===========================================================================
  async list(userId: string, query: ProductsQueryDto): Promise<PaginatedResponse<ProductResponse>> {
    const {
      page,
      per_page,
      search,
      category_id,
      estado,
      tipo_compra,
      warranty_status,
      fecha_desde,
      fecha_hasta,
      sort_by,
      sort_order,
    } = query;

    const where: Prisma.ProductWhereInput = {
      user_id: userId,
      deleted_at: null,
    };

    if (category_id) where.categoria_id = category_id;
    if (estado) where.estado = estado;
    if (tipo_compra) where.tipo_compra = tipo_compra;

    if (fecha_desde || fecha_hasta) {
      where.fecha_compra = {};
      if (fecha_desde) where.fecha_compra.gte = new Date(fecha_desde);
      if (fecha_hasta) where.fecha_compra.lte = new Date(fecha_hasta);
    }

    if (search) {
      // Búsqueda case-insensitive en nombre, marca, modelo y descripción.
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { marca: { contains: search, mode: 'insensitive' } },
        { modelo: { contains: search, mode: 'insensitive' } },
        { descripcion: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput = this.buildOrderBy(sort_by, sort_order);

    const skip = (page - 1) * per_page;
    const take = per_page;

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          categoria: { select: { id: true, nombre: true, icono: true } },
          _count: { select: { attachments: true } },
        },
      }),
    ]);

    let items = products.map((p) => this.toResponse(p));

    // Filtro post-query: warranty_status requiere calcular fechas.
    if (warranty_status) {
      items = items.filter((p) => p.warranty_status === warranty_status);
    }

    return {
      items,
      pagination: {
        page,
        per_page,
        total,
        total_pages: Math.ceil(total / per_page),
      },
    };
  }

  // ===========================================================================
  // GET BY ID
  // ===========================================================================
  async findOne(userId: string, productId: string): Promise<ProductResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, user_id: userId, deleted_at: null },
      include: {
        categoria: { select: { id: true, nombre: true, icono: true } },
        attachments: { orderBy: { created_at: 'asc' } },
        _count: { select: { attachments: true } },
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado.');
    }

    const response = this.toResponse(product);
    // Adjuntamos los attachments completos para la vista de detalle.
    return { ...response, attachments: product.attachments } as ProductResponse;
  }

  // ===========================================================================
  // CREATE
  // ===========================================================================
  async create(userId: string, dto: CreateProductDto): Promise<ProductResponse> {
    if (dto.categoria_id) {
      await this.assertCategoriaAccesible(userId, dto.categoria_id);
    }

    // Auto-calcular fecha_vencimiento_garantia si se da duración pero no fecha.
    let fechaVencimiento: Date | null = dto.fecha_vencimiento_garantia
      ? new Date(dto.fecha_vencimiento_garantia)
      : null;

    if (!fechaVencimiento && dto.duracion_garantia_meses && dto.fecha_compra) {
      fechaVencimiento = new Date(dto.fecha_compra);
      fechaVencimiento.setMonth(fechaVencimiento.getMonth() + dto.duracion_garantia_meses);
    }

    const product = await this.prisma.product.create({
      data: {
        user_id: userId,
        nombre: dto.nombre,
        categoria_id: dto.categoria_id ?? null,
        marca: dto.marca ?? null,
        modelo: dto.modelo ?? null,
        descripcion: dto.descripcion ?? null,
        fecha_compra: new Date(dto.fecha_compra),
        lugar_compra: dto.lugar_compra ?? null,
        tipo_compra: dto.tipo_compra as PurchaseType,
        precio: new Prisma.Decimal(dto.precio),
        moneda: dto.moneda ?? 'USD',
        metodo_pago: dto.metodo_pago ?? null,
        numero_serie: dto.numero_serie ?? null,
        duracion_garantia_meses: dto.duracion_garantia_meses ?? null,
        fecha_vencimiento_garantia: fechaVencimiento,
        estado: (dto.estado ?? ProductStatus.NUEVO) as ProductStatus,
        notas: dto.notas ?? null,
        tags: dto.tags ?? null,
      },
      include: {
        categoria: { select: { id: true, nombre: true, icono: true } },
        _count: { select: { attachments: true } },
      },
    });

    this.logger.log(`Producto creado: ${product.id} por usuario ${userId}`);
    return this.toResponse(product);
  }

  // ===========================================================================
  // UPDATE
  // ===========================================================================
  async update(userId: string, productId: string, dto: UpdateProductDto): Promise<ProductResponse> {
    // Verificamos ownership ANTES de hacer nada.
    await this.assertOwned(userId, productId);

    if (dto.categoria_id) {
      await this.assertCategoriaAccesible(userId, dto.categoria_id);
    }

    // Recalcular fecha_vencimiento si cambia duración o fecha_compra.
    let fechaVencimiento: Date | null | undefined = undefined;
    if (dto.fecha_vencimiento_garantia) {
      fechaVencimiento = new Date(dto.fecha_vencimiento_garantia);
    } else if (dto.duracion_garantia_meses !== undefined && dto.fecha_compra) {
      fechaVencimiento = new Date(dto.fecha_compra);
      fechaVencimiento.setMonth(fechaVencimiento.getMonth() + dto.duracion_garantia_meses);
    }

    const data: Prisma.ProductUpdateInput = {
      ...(dto.nombre !== undefined && { nombre: dto.nombre }),
      ...(dto.categoria_id !== undefined && { categoria_id: dto.categoria_id }),
      ...(dto.marca !== undefined && { marca: dto.marca }),
      ...(dto.modelo !== undefined && { modelo: dto.modelo }),
      ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
      ...(dto.fecha_compra !== undefined && { fecha_compra: new Date(dto.fecha_compra) }),
      ...(dto.lugar_compra !== undefined && { lugar_compra: dto.lugar_compra }),
      ...(dto.tipo_compra !== undefined && { tipo_compra: dto.tipo_compra as PurchaseType }),
      ...(dto.precio !== undefined && { precio: new Prisma.Decimal(dto.precio) }),
      ...(dto.moneda !== undefined && { moneda: dto.moneda }),
      ...(dto.metodo_pago !== undefined && { metodo_pago: dto.metodo_pago }),
      ...(dto.numero_serie !== undefined && { numero_serie: dto.numero_serie }),
      ...(dto.duracion_garantia_meses !== undefined && {
        duracion_garantia_meses: dto.duracion_garantia_meses,
      }),
      ...(fechaVencimiento !== undefined && { fecha_vencimiento_garantia: fechaVencimiento }),
      ...(dto.estado !== undefined && { estado: dto.estado as ProductStatus }),
      ...(dto.notas !== undefined && { notas: dto.notas }),
      ...(dto.tags !== undefined && { tags: dto.tags }),
    };

    const product = await this.prisma.product.update({
      where: { id: productId },
      data,
      include: {
        categoria: { select: { id: true, nombre: true, icono: true } },
        _count: { select: { attachments: true } },
      },
    });

    return this.toResponse(product);
  }

  // ===========================================================================
  // DELETE (lógico)
  // ===========================================================================
  async remove(userId: string, productId: string): Promise<{ message: string }> {
    await this.assertOwned(userId, productId);

    await this.prisma.product.update({
      where: { id: productId },
      data: { deleted_at: new Date() },
    });

    this.logger.log(`Producto ${productId} marcado como borrado por usuario ${userId}`);
    return { message: 'Producto eliminado.' };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================
  private async assertOwned(userId: string, productId: string): Promise<void> {
    const exists = await this.prisma.product.findFirst({
      where: { id: productId, user_id: userId, deleted_at: null },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Producto no encontrado.');
    }
  }

  private async assertCategoriaAccesible(userId: string, categoriaId: string): Promise<void> {
    const cat = await this.prisma.category.findFirst({
      where: {
        id: categoriaId,
        OR: [{ user_id: userId }, { user_id: null }],
      },
    });
    if (!cat) {
      throw new BadRequestException('Categoría no válida.');
    }
  }

  private buildOrderBy(
    sortBy: SortBy,
    sortOrder: SortOrder,
  ): Prisma.ProductOrderByWithRelationInput {
    // tiempo_posesion = (now - fecha_compra) → DESC = más viejo primero, ASC = más reciente primero.
    if (sortBy === SortBy.TIEMPO_POSESION) {
      return { fecha_compra: sortOrder };
    }
    switch (sortBy) {
      case SortBy.NOMBRE:
        return { nombre: sortOrder };
      case SortBy.PRECIO:
        return { precio: sortOrder };
      case SortBy.CREATED_AT:
        return { created_at: sortOrder };
      case SortBy.FECHA_COMPRA:
      default:
        return { fecha_compra: sortOrder };
    }
  }

  private toResponse(
    product: Product & {
      categoria?: { id: string; nombre: string; icono: string | null } | null;
      _count?: { attachments: number };
    },
  ): ProductResponse {
    const duration = calculateOwnershipDuration(product.fecha_compra);
    const warranty = getWarrantyStatus(product.fecha_vencimiento_garantia);

    const days_until_warranty_expires = product.fecha_vencimiento_garantia
      ? Math.ceil(
          (product.fecha_vencimiento_garantia.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        )
      : null;

    return {
      ...product,
      tiempo_posesion: formatOwnership(duration),
      warranty_status: warranty,
      days_until_warranty_expires,
      categoria: product.categoria ?? null,
      attachments_count: product._count?.attachments ?? 0,
    };
  }
}
