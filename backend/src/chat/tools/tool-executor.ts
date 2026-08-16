// =============================================================================
// ToolExecutor - ejecuta las tools contra la base de datos del propio backend
// =============================================================================
// Cada tool hace UNA cosa concreta y devuelve un objeto JSON. Si algo falla,
// lanza un error que el service captura y devuelve a la IA como
// { error: "mensaje" } para que ella formule una respuesta amable.
//
// Validación: TODOS los argumentos pasan por los schemas zod de ./schemas
// ANTES de tocar la base de datos (misma fuente de verdad que el JSON schema
// que ve el LLM). Un argumento inválido devuelve { error } descriptivo y la
// IA puede corregirse — nunca llega un valor crudo a Prisma.
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
import {
  TOOL_SCHEMAS,
  buscarProductosSchema,
  crearProductoSchema,
  garantiasPorVencerSchema,
  resumenGastosSchema,
} from './schemas';
import type { z } from 'zod';

type Args = Record<string, unknown>;

@Injectable()
export class ChatToolExecutor {
  private readonly logger = new Logger(ChatToolExecutor.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Despacha una tool call al handler correspondiente.
   * Los argumentos se validan contra el schema zod de la tool: si no pasan,
   * se devuelve { error } (la IA puede corregirse) sin ejecutar nada.
   * Devuelve un objeto listo para enviar de vuelta a la IA.
   */
  async execute(userId: string, name: string, args: Args): Promise<unknown> {
    try {
      const schema = TOOL_SCHEMAS[name as keyof typeof TOOL_SCHEMAS];
      if (!schema) {
        return { error: `Función desconocida: ${name}` };
      }

      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          error: `Argumentos inválidos para ${name}: ${parsed.error.issues
            .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
            .join('; ')}`,
        };
      }

      switch (name) {
        case 'buscar_productos':
          return await this.buscarProductos(
            userId,
            parsed.data as z.infer<typeof buscarProductosSchema>,
          );
        case 'crear_producto':
          return await this.crearProducto(
            userId,
            parsed.data as z.infer<typeof crearProductoSchema>,
          );
        case 'consultar_garantias_por_vencer':
          return await this.garantiasPorVencer(
            userId,
            parsed.data as z.infer<typeof garantiasPorVencerSchema>,
          );
        case 'resumen_gastos':
          return await this.resumenGastos(
            userId,
            parsed.data as z.infer<typeof resumenGastosSchema>,
          );
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
  private async buscarProductos(userId: string, args: z.infer<typeof buscarProductosSchema>) {
    const where: Prisma.ProductWhereInput = { user_id: userId, deleted_at: null };

    if (args.search?.trim()) {
      where.OR = [
        { nombre: ciContains(args.search) },
        { marca: ciContains(args.search) },
        { modelo: ciContains(args.search) },
      ];
    }
    if (args.categoria_id) where.categoria_id = args.categoria_id;
    if (args.estado) where.estado = args.estado as Prisma.EnumProductStatusFilter;

    // warranty_status SÍ filtra en SQL (no post-query), con el mismo criterio
    // que buildListWhere de products.service.ts: vencida = ya venció,
    // por_vencer = ≤ 30 días, vigente = > 30 días. Los productos sin fecha de
    // vencimiento quedan fuera de los tres (comparaciones con null son falsas).
    if (args.warranty_status) {
      const now = new Date();
      const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (args.warranty_status === 'vencida') {
        where.fecha_vencimiento_garantia = { lt: now };
      } else if (args.warranty_status === 'por_vencer') {
        where.fecha_vencimiento_garantia = { gt: now, lte: in30Days };
      } else {
        where.fecha_vencimiento_garantia = { gt: in30Days };
      }
    }

    if (args.fecha_desde || args.fecha_hasta) {
      where.fecha_compra = {};
      if (args.fecha_desde) where.fecha_compra.gte = new Date(args.fecha_desde);
      if (args.fecha_hasta) where.fecha_compra.lte = new Date(args.fecha_hasta);
    }

    // El schema ya acota limit a 1..50; 20 es el default.
    const limit = args.limit ?? 20;

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
  private async crearProducto(userId: string, args: z.infer<typeof crearProductoSchema>) {
    // Los required (nombre, fecha_compra, tipo_compra, precio) ya los exige el
    // schema zod: si faltan, execute() devuelve { error } sin llegar acá.

    let fechaVencimiento: Date | null = null;
    if (args.duracion_garantia_meses) {
      // Misma convención que products.service.create: aritmética de meses en
      // UTC para que el día resultante no dependa de la zona horaria.
      fechaVencimiento = new Date(`${args.fecha_compra}T00:00:00Z`);
      fechaVencimiento.setUTCMonth(fechaVencimiento.getUTCMonth() + args.duracion_garantia_meses);
    }

    const product = await this.prisma.product.create({
      data: {
        user_id: userId,
        nombre: args.nombre,
        marca: args.marca ?? null,
        modelo: args.modelo ?? null,
        descripcion: args.descripcion ?? null,
        fecha_compra: new Date(args.fecha_compra),
        lugar_compra: args.lugar_compra ?? null,
        tipo_compra: args.tipo_compra as PurchaseType,
        precio: new Prisma.Decimal(args.precio),
        moneda: args.moneda ?? 'USD',
        duracion_garantia_meses: args.duracion_garantia_meses ?? null,
        fecha_vencimiento_garantia: fechaVencimiento,
        notas: args.notas ?? null,
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
  private async garantiasPorVencer(userId: string, args: z.infer<typeof garantiasPorVencerSchema>) {
    // El schema acota dias a 1..365; 30 es el default.
    const dias = args.dias ?? 30;
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
  private async resumenGastos(userId: string, args: z.infer<typeof resumenGastosSchema>) {
    const periodo = args.periodo ?? 'anio_actual';
    const { desde, hasta } = this.resolvePeriodo(periodo);

    const where: Prisma.ProductWhereInput = {
      user_id: userId,
      deleted_at: null,
      fecha_compra: { gte: desde, lte: hasta },
    };
    if (args.categoria_id) where.categoria_id = args.categoria_id;

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
