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
import { Prisma, Product, ProductStatus, PurchaseType } from '../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsQueryDto, SortBy, SortOrder } from './dto/products-query.dto';
import { buildProductsCsv, formatCsvDate, parseProductsCsv, type CsvRow } from './csv';
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

export interface CsvImportRowError {
  row: number; // nº de línea del archivo (1 = cabecera, por eso la primera fila es la 2)
  message: string;
}

export interface CsvImportResult {
  imported: number;
  skipped: number;
  errors: CsvImportRowError[];
  created_categories: string[];
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  // TTL del caché de listados: los productos cambian con frecuencia, 60s es
  // un buen equilibrio entre ahorro de queries y frescura de datos.
  private static readonly LIST_CACHE_TTL = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ===========================================================================
  // LIST - paginado, filtrable, buscable, ordenable
  // ===========================================================================
  async list(userId: string, query: ProductsQueryDto): Promise<PaginatedResponse<ProductResponse>> {
    // Clave estable: solo los campos que afectan el resultado (ignoramos el
    // orden de las propiedades del objeto serializado con JSON.stringify).
    const cacheKey = `cache:products:list:${userId}:${this.hashQuery(query)}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as PaginatedResponse<ProductResponse>;
    }

    const result = await this.queryList(userId, query);

    // RedisService.get/set son no-op si Redis no está disponible.
    await this.redis.set(cacheKey, JSON.stringify(result), ProductsService.LIST_CACHE_TTL);
    return result;
  }

  /** Invalida el caché de listados del usuario (tras crear/editar/borrar/importar). */
  private async invalidateListCache(userId: string): Promise<void> {
    await this.redis.delPattern(`cache:products:list:${userId}:*`);
  }

  /** Hash simple y estable de la query (filtros + paginación + orden). */
  private hashQuery(query: ProductsQueryDto): string {
    const canonical = JSON.stringify(query, Object.keys(query).sort());
    let hash = 0;
    for (let i = 0; i < canonical.length; i++) {
      hash = (hash << 5) - hash + canonical.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  /** Ejecuta la consulta real (sin caché). */
  private async queryList(
    userId: string,
    query: ProductsQueryDto,
  ): Promise<PaginatedResponse<ProductResponse>> {
    const { page, per_page, warranty_status, sort_by, sort_order } = query;

    const where = this.buildListWhere(userId, query);
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
    await this.invalidateListCache(userId);
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

    await this.invalidateListCache(userId);
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
    await this.invalidateListCache(userId);
    return { message: 'Producto eliminado.' };
  }

  // ===========================================================================
  // EXPORT CSV
  // ===========================================================================
  /**
   * Genera el CSV con TODOS los productos del usuario (respetando los mismos
   * filtros del listado, sin paginación). El archivo resultante puede
   * re-importarse tal cual.
   */
  async exportCsv(
    userId: string,
    query: ProductsQueryDto,
  ): Promise<{ filename: string; content: string }> {
    const where = this.buildListWhere(userId, query);

    const products = await this.prisma.product.findMany({
      where,
      orderBy: this.buildOrderBy(query.sort_by, query.sort_order),
      include: { categoria: { select: { nombre: true } } },
    });

    let rows: CsvRow[] = products.map((p) => ({
      nombre: p.nombre,
      categoria: p.categoria?.nombre ?? '',
      marca: p.marca ?? '',
      modelo: p.modelo ?? '',
      descripcion: p.descripcion ?? '',
      fecha_compra: formatCsvDate(p.fecha_compra),
      lugar_compra: p.lugar_compra ?? '',
      tipo_compra: p.tipo_compra,
      precio: p.precio.toString(),
      moneda: p.moneda,
      metodo_pago: p.metodo_pago ?? '',
      numero_serie: p.numero_serie ?? '',
      duracion_garantia_meses: p.duracion_garantia_meses?.toString() ?? '',
      fecha_vencimiento_garantia: p.fecha_vencimiento_garantia
        ? formatCsvDate(p.fecha_vencimiento_garantia)
        : '',
      estado: p.estado,
      notas: p.notas ?? '',
      tags: p.tags ?? '',
    }));

    // El filtro de warranty_status se aplica post-query (igual que en list).
    if (query.warranty_status) {
      rows = rows.filter((row) => {
        if (!row.fecha_vencimiento_garantia) return false;
        const status = getWarrantyStatus(new Date(`${row.fecha_vencimiento_garantia}T00:00:00Z`));
        return status === query.warranty_status;
      });
    }

    const date = formatCsvDate(new Date());
    return {
      filename: `inventariopro-productos-${date}.csv`,
      content: buildProductsCsv(rows),
    };
  }

  // ===========================================================================
  // IMPORT CSV
  // ===========================================================================
  /**
   * Importa productos desde un CSV. Valida fila a fila: las válidas se crean y
   * las inválidas se reportan con su número de línea (no se aborta todo el
   * archivo). Las categorías por nombre se resuelven (case-insensitive); si no
   * existen se crean como categorías personalizadas del usuario.
   */
  async importCsv(userId: string, csvContent: string): Promise<CsvImportResult> {
    const rows = parseProductsCsv(csvContent);
    if (rows.length === 0) {
      throw new BadRequestException('El CSV está vacío o solo contiene la cabecera.');
    }

    const imported: string[] = [];
    const errors: CsvImportRowError[] = [];
    const createdCategories: string[] = [];
    const categoryCache = new Map<string, string | null>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // +1 por el índice, +1 por la cabecera
      try {
        const data = this.validateCsvRow(rows[i]);
        const categoriaId = data.categoria
          ? await this.resolveCategoria(userId, data.categoria, categoryCache, createdCategories)
          : null;

        // Auto-calcular vencimiento de garantía (misma regla que create).
        let fechaVencimiento: Date | null = data.fechaVencimientoGarantia
          ? new Date(data.fechaVencimientoGarantia)
          : null;
        if (!fechaVencimiento && data.duracionGarantiaMeses && data.fechaCompra) {
          fechaVencimiento = new Date(data.fechaCompra);
          fechaVencimiento.setMonth(fechaVencimiento.getMonth() + data.duracionGarantiaMeses);
        }

        const product = await this.prisma.product.create({
          data: {
            user_id: userId,
            nombre: data.nombre,
            categoria_id: categoriaId,
            marca: data.marca,
            modelo: data.modelo,
            descripcion: data.descripcion,
            fecha_compra: data.fechaCompra,
            lugar_compra: data.lugarCompra,
            tipo_compra: data.tipoCompra,
            precio: new Prisma.Decimal(data.precio),
            moneda: data.moneda,
            metodo_pago: data.metodoPago,
            numero_serie: data.numeroSerie,
            duracion_garantia_meses: data.duracionGarantiaMeses,
            fecha_vencimiento_garantia: fechaVencimiento,
            estado: data.estado,
            notas: data.notas,
            tags: data.tags,
          },
        });
        imported.push(product.id);
      } catch (err) {
        errors.push({
          row: rowNumber,
          message: err instanceof Error ? err.message : 'Fila inválida.',
        });
      }
    }

    if (imported.length > 0) {
      this.logger.log(`Import CSV: ${imported.length} productos para usuario ${userId}`);
      await this.invalidateListCache(userId);
    }
    return {
      imported: imported.length,
      skipped: errors.length,
      errors,
      created_categories: createdCategories,
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================
  /** Construye el where del listado (filtros + búsqueda), compartido por list y export. */
  private buildListWhere(userId: string, query: ProductsQueryDto): Prisma.ProductWhereInput {
    const { search, category_id, estado, tipo_compra, fecha_desde, fecha_hasta } = query;

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

    return where;
  }

  /**
   * Valida una fila del CSV y devuelve los valores normalizados, o lanza un
   * error con el mensaje para la fila.
   */
  private validateCsvRow(row: CsvRow): {
    nombre: string;
    categoria: string | null;
    marca: string | null;
    modelo: string | null;
    descripcion: string | null;
    fechaCompra: Date;
    lugarCompra: string | null;
    tipoCompra: PurchaseType;
    precio: string;
    moneda: string;
    metodoPago: string | null;
    numeroSerie: string | null;
    duracionGarantiaMeses: number | null;
    fechaVencimientoGarantia: string | null;
    estado: ProductStatus;
    notas: string | null;
    tags: string | null;
  } {
    const get = (key: string): string => (row[key] ?? '').trim();

    const nombre = get('nombre');
    if (!nombre) throw new BadRequestException('Falta el nombre.');
    if (nombre.length > 200) throw new BadRequestException('El nombre supera 200 caracteres.');

    const categoria = get('categoria') || null;
    const marca = get('marca') || null;
    const modelo = get('modelo') || null;
    const descripcion = get('descripcion') || null;
    const lugarCompra = get('lugar_compra') || null;
    const metodoPago = get('metodo_pago') || null;
    const numeroSerie = get('numero_serie') || null;
    const notas = get('notas') || null;
    const tags = get('tags') || null;

    // Fecha de compra (YYYY-MM-DD o ISO completo).
    const fechaCompraRaw = get('fecha_compra');
    const fechaCompra = this.parseDate(fechaCompraRaw, 'fecha_compra');

    const tipoCompraRaw = get('tipo_compra').toUpperCase();
    if (tipoCompraRaw !== PurchaseType.FISICO && tipoCompraRaw !== PurchaseType.ONLINE) {
      throw new BadRequestException('tipo_compra debe ser FISICO u ONLINE.');
    }

    const precioRaw = get('precio').replace(',', '.');
    const precio = Number(precioRaw);
    if (!precioRaw || Number.isNaN(precio) || precio < 0) {
      throw new BadRequestException('precio debe ser un número mayor o igual que 0.');
    }

    const moneda = (get('moneda') || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(moneda)) {
      throw new BadRequestException('moneda debe ser un código ISO 4217 de 3 letras.');
    }

    const duracionRaw = get('duracion_garantia_meses');
    let duracionGarantiaMeses: number | null = null;
    if (duracionRaw) {
      duracionGarantiaMeses = Number(duracionRaw);
      if (!Number.isInteger(duracionGarantiaMeses) || duracionGarantiaMeses <= 0) {
        throw new BadRequestException('duracion_garantia_meses debe ser un entero positivo.');
      }
    }

    const fechaVencimientoRaw = get('fecha_vencimiento_garantia');
    const fechaVencimientoGarantia = fechaVencimientoRaw
      ? this.parseDate(fechaVencimientoRaw, 'fecha_vencimiento_garantia').toISOString()
      : null;

    const estadoRaw = (get('estado') || ProductStatus.NUEVO).toUpperCase() as ProductStatus;
    const estados = Object.values(ProductStatus);
    if (!estados.includes(estadoRaw)) {
      throw new BadRequestException(`estado debe ser uno de: ${estados.join(', ')}.`);
    }

    return {
      nombre,
      categoria,
      marca,
      modelo,
      descripcion,
      fechaCompra,
      lugarCompra,
      tipoCompra: tipoCompraRaw as PurchaseType,
      precio: precio.toFixed(2),
      moneda,
      metodoPago,
      numeroSerie,
      duracionGarantiaMeses,
      fechaVencimientoGarantia,
      estado: estadoRaw,
      notas,
      tags,
    };
  }

  /** Parsea YYYY-MM-DD (o ISO completo) a Date, o lanza error de fila. */
  private parseDate(value: string, field: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(value)) {
      throw new BadRequestException(`${field} debe tener formato YYYY-MM-DD.`);
    }
    const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} no es una fecha válida.`);
    }
    return date;
  }

  /** Resuelve la categoría por nombre; la crea si no existe (cache por import). */
  private async resolveCategoria(
    userId: string,
    nombre: string,
    cache: Map<string, string | null>,
    createdCategories: string[],
  ): Promise<string | null> {
    const key = nombre.toLowerCase();
    if (cache.has(key)) return cache.get(key) ?? null;

    const existing = await this.prisma.category.findFirst({
      where: {
        nombre: { equals: nombre, mode: 'insensitive' },
        OR: [{ user_id: userId }, { user_id: null }],
      },
      select: { id: true },
    });
    if (existing) {
      cache.set(key, existing.id);
      return existing.id;
    }

    const created = await this.prisma.category.create({
      data: { nombre, user_id: userId },
    });
    createdCategories.push(created.nombre);
    cache.set(key, created.id);
    return created.id;
  }

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
