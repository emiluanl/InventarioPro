// =============================================================================
// ToolExecutor - ejecuta las tools contra la base de datos del propio backend
// =============================================================================
// Cada tool hace UNA cosa concreta y devuelve un objeto JSON. Si algo falla,
// lanza un error que el service captura y devuelve a la IA como
// { error: "mensaje" } para que ella formule una respuesta amable.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PurchaseType } from '../../generated/prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  calculateOwnershipDuration,
  formatOwnership,
  getWarrantyStatus,
} from '../../common/lib/time-ownership';
import { ciContains } from '../../common/lib/prisma-filters';

type Args = Record<string, unknown>;

@Injectable()
export class ChatToolExecutor {
  private readonly logger = new Logger(ChatToolExecutor.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Despacha una tool call al handler correspondiente.
   * Devuelve un objeto listo para enviar de vuelta a la IA.
   */
  async execute(userId: string, name: string, args: Args): Promise<unknown> {
    try {
      switch (name) {
        case 'buscar_productos':
          return await this.buscarProductos(userId, args);
        case 'crear_producto':
          return await this.crearProducto(userId, args);
        case 'consultar_garantias_por_vencer':
          return await this.garantiasPorVencer(userId, args);
        case 'resumen_gastos':
          return await this.resumenGastos(userId, args);
        default:
          return { error: `Función desconocida: ${name}` };
      }
    } catch (err) {
      this.logger.error(`Error ejecutando tool ${name}: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  }

  // ===========================================================================
  // buscar_productos
  // ===========================================================================
  private async buscarProductos(userId: string, args: Args) {
    const where: Prisma.ProductWhereInput = { user_id: userId, deleted_at: null };

    if (typeof args.search === 'string' && args.search.trim()) {
      where.OR = [
        { nombre: ciContains(args.search) },
        { marca: ciContains(args.search) },
        { modelo: ciContains(args.search) },
      ];
    }
    if (typeof args.categoria_id === 'string') where.categoria_id = args.categoria_id;
    if (typeof args.estado === 'string')
      where.estado = args.estado as Prisma.EnumProductStatusFilter;

    if (typeof args.fecha_desde === 'string' || typeof args.fecha_hasta === 'string') {
      where.fecha_compra = {};
      if (typeof args.fecha_desde === 'string') where.fecha_compra.gte = new Date(args.fecha_desde);
      if (typeof args.fecha_hasta === 'string') where.fecha_compra.lte = new Date(args.fecha_hasta);
    }

    const limit = Math.min(Number(args.limit ?? 20), 50);

    const products = await this.prisma.product.findMany({
      where,
      take: limit,
      orderBy: { fecha_compra: 'desc' },
      include: { categoria: { select: { nombre: true } } },
    });

    const now = new Date();
    return products.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      marca: p.marca,
      categoria: p.categoria?.nombre ?? null,
      fecha_compra: p.fecha_compra.toISOString().slice(0, 10),
      precio: p.precio.toString(),
      moneda: p.moneda,
      tiempo_posesion: formatOwnership(calculateOwnershipDuration(p.fecha_compra, now)),
      warranty_status: getWarrantyStatus(p.fecha_vencimiento_garantia, now),
    }));
  }

  // ===========================================================================
  // crear_producto
  // ===========================================================================
  private async crearProducto(userId: string, args: Args) {
    const required = ['nombre', 'fecha_compra', 'tipo_compra', 'precio'];
    for (const key of required) {
      if (args[key] === undefined || args[key] === null) {
        return { error: `Falta el campo obligatorio "${key}".` };
      }
    }

    let fechaVencimiento: Date | null = null;
    if (typeof args.duracion_garantia_meses === 'number') {
      fechaVencimiento = new Date(args.fecha_compra as string);
      fechaVencimiento.setMonth(fechaVencimiento.getMonth() + args.duracion_garantia_meses);
    }

    const product = await this.prisma.product.create({
      data: {
        user_id: userId,
        nombre: String(args.nombre),
        marca: typeof args.marca === 'string' ? args.marca : null,
        modelo: typeof args.modelo === 'string' ? args.modelo : null,
        descripcion: typeof args.descripcion === 'string' ? args.descripcion : null,
        fecha_compra: new Date(args.fecha_compra as string),
        lugar_compra: typeof args.lugar_compra === 'string' ? args.lugar_compra : null,
        tipo_compra: args.tipo_compra as PurchaseType,
        precio: new Prisma.Decimal(Number(args.precio)),
        moneda: typeof args.moneda === 'string' ? args.moneda : 'USD',
        duracion_garantia_meses:
          typeof args.duracion_garantia_meses === 'number' ? args.duracion_garantia_meses : null,
        fecha_vencimiento_garantia: fechaVencimiento,
        notas: typeof args.notas === 'string' ? args.notas : null,
      },
    });

    return {
      ok: true,
      product: {
        id: product.id,
        nombre: product.nombre,
        fecha_compra: product.fecha_compra.toISOString().slice(0, 10),
        precio: product.precio.toString(),
        moneda: product.moneda,
      },
    };
  }

  // ===========================================================================
  // consultar_garantias_por_vencer
  // ===========================================================================
  private async garantiasPorVencer(userId: string, args: Args) {
    const dias = Math.min(Number(args.dias ?? 30), 365);
    const limit = new Date();
    limit.setDate(limit.getDate() + dias);

    const products = await this.prisma.product.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        fecha_vencimiento_garantia: { not: null, lte: limit, gte: new Date() },
      },
      orderBy: { fecha_vencimiento_garantia: 'asc' },
      take: 50,
    });

    return products.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      fecha_vencimiento: p.fecha_vencimiento_garantia?.toISOString().slice(0, 10) ?? null,
      dias_restantes: p.fecha_vencimiento_garantia
        ? Math.ceil((p.fecha_vencimiento_garantia.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null,
    }));
  }

  // ===========================================================================
  // resumen_gastos
  // ===========================================================================
  private async resumenGastos(userId: string, args: Args) {
    const periodo = String(args.periodo ?? 'anio_actual');
    const { desde, hasta } = this.resolvePeriodo(periodo);

    const where: Prisma.ProductWhereInput = {
      user_id: userId,
      deleted_at: null,
      fecha_compra: { gte: desde, lte: hasta },
    };
    if (typeof args.categoria_id === 'string') where.categoria_id = args.categoria_id;

    const products = await this.prisma.product.findMany({
      where,
      include: { categoria: { select: { id: true, nombre: true } } },
    });

    const total = products.reduce((acc, p) => acc + Number(p.precio), 0);
    const porCategoria: Record<string, number> = {};
    for (const p of products) {
      const key = p.categoria?.nombre ?? 'Sin categoría';
      porCategoria[key] = (porCategoria[key] ?? 0) + Number(p.precio);
    }

    return {
      periodo,
      desde: desde.toISOString().slice(0, 10),
      hasta: hasta.toISOString().slice(0, 10),
      total: total.toFixed(2),
      cantidad_productos: products.length,
      por_categoria: porCategoria,
    };
  }

  private resolvePeriodo(periodo: string): { desde: Date; hasta: Date } {
    const now = new Date();
    const hasta = new Date(now);
    const desde = new Date(now);

    switch (periodo) {
      case 'mes_actual':
        desde.setDate(1);
        desde.setHours(0, 0, 0, 0);
        break;
      case 'mes_pasado': {
        const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        hasta.setTime(firstOfThisMonth.getTime() - 1);
        desde.setTime(new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime());
        break;
      }
      case 'ultimos_30_dias':
        desde.setDate(desde.getDate() - 30);
        break;
      case 'ultimos_90_dias':
        desde.setDate(desde.getDate() - 90);
        break;
      case 'anio_actual':
      default:
        desde.setMonth(0, 1);
        desde.setHours(0, 0, 0, 0);
    }

    return { desde, hasta };
  }
}
