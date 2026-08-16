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

/**
 * Confirmación pendiente de crear_producto (deduplicación CONSULTIVA).
 * Se guarda en memoria, AISLADA por conversación (clave `${userId}:${conversationId}`),
 * con los argumentos ORIGINALES que el usuario vio al preguntarle. TTL de
 * 10 minutos: si el usuario abandona el flujo, la entrada expira sola.
 *
 * Estado EN MEMORIA (no persiste): suficiente para una app personal de un
 * solo backend. Al reiniciar el proceso se pierde de forma SEGURA — el
 * usuario solo tiene que volver a intentarlo y la tool vuelve a preguntar;
 * nunca hay un "confirmar" huérfano que cree algo sin confirmación real.
 */
interface PendingConfirmation {
  args: z.infer<typeof crearProductoSchema>;
  createdAt: number;
}

// Obligatorios de crear_producto en el camino de creación real (sin confirmar).
// El schema zod los deja opcionales a propósito para que la confirmación pueda
// llegar sola; el executor los exige únicamente cuando NO hay confirmar.
const REQUIRED_CREATE_FIELDS = ['nombre', 'fecha_compra', 'tipo_compra', 'precio'] as const;

@Injectable()
export class ChatToolExecutor {
  private static readonly PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutos
  private readonly logger = new Logger(ChatToolExecutor.name);
  private readonly pendingConfirmations = new Map<string, PendingConfirmation>();

  /** Clave del pendiente: aislado por usuario Y por conversación. */
  private static pendingKey(userId: string, conversationId: string): string {
    return `${userId}:${conversationId}`;
  }

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Despacha una tool call al handler correspondiente.
   * Los argumentos se validan contra el schema zod de la tool: si no pasan,
   * se devuelve { error } (la IA puede corregirse) sin ejecutar nada.
   * Devuelve un objeto listo para enviar de vuelta a la IA.
   */
  async execute(
    userId: string,
    conversationId: string,
    name: string,
    args: Args,
  ): Promise<unknown> {
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
            conversationId,
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
      // El detalle REAL siempre queda en los logs del servidor.
      this.logger.error(`Error ejecutando tool ${name}: ${(err as Error).message}`);
      // Hacia la IA (y de ahí al usuario) NUNCA viajan mensajes internos de
      // Prisma (SQL, nombres de constraint, valores): solo un mensaje genérico.
      return { error: this.sanitizeError(err) };
    }
  }

  /**
   * Mensaje seguro hacia el LLM: nunca filtra detalles internos de Prisma.
   * La validación de argumentos (zod) ya devuelve mensajes descriptivos antes
   * de llegar acá; este catch es la red de seguridad de errores inesperados.
   */
  private sanitizeError(err: unknown): string {
    const ctor = (err as { constructor?: { name?: string } })?.constructor?.name ?? '';
    if (ctor.startsWith('PrismaClient')) {
      return 'Error interno al consultar los datos. Inténtalo de nuevo.';
    }
    return 'Ocurrió un error al ejecutar la herramienta. Inténtalo de nuevo.';
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
  // Deduplicación CONSULTIVA (nunca automática) con confirmación pendiente:
  //   1) Llamada sin `confirmar` y con duplicado (mismo nombre + fecha) →
  //      devuelve needs_confirmation y GUARDA los argumentos originales.
  //   2) Llamada con `confirmar: true` SOLO (sin repetir datos) → crea SOLO si
  //      hay una confirmación pendiente, con los argumentos ORIGINALES
  //      guardados (lo que la IA repita en esta llamada se ignora), y limpia.
  //   3) Llamada con `confirmar: false` SOLO → el usuario rechazó: no crea y
  //      limpia el pendiente.
  //   4) Sin `confirmar` → creación real: exige los obligatorios (el schema los
  //      deja opcionales), y sin duplicados crea directo descartando pendientes
  //      viejos.
  // `confirmar: true` SIN pendiente previo se rechaza: la IA no puede
  // auto-confirmar un duplicado que el usuario nunca vio.
  private async crearProducto(
    userId: string,
    conversationId: string,
    args: z.infer<typeof crearProductoSchema>,
  ) {
    // El schema permite { confirmar: true } / { confirmar: false } SOLOS (sin
    // repetir los datos), así que los campos obligatorios solo se exigen en el
    // camino de creación real (sin confirmar).

    const key = ChatToolExecutor.pendingKey(userId, conversationId);
    const pending = this.getPending(key);

    if (args.confirmar === true) {
      if (!pending) {
        return {
          error:
            'No hay una confirmación pendiente para crear este producto en esta conversación. Pedí confirmación primero.',
        };
      }
      this.pendingConfirmations.delete(key);
      // Se crea EXCLUSIVAMENTE con los argumentos ORIGINALES guardados: los que
      // la IA repita en esta llamada (alterados o no) se ignoran.
      return this.createProductFromArgs(userId, pending.args);
    }

    if (args.confirmar === false) {
      if (pending) this.pendingConfirmations.delete(key);
      return { cancelada: true, message: 'No se creó el producto.' };
    }

    // Camino de creación real: los obligatorios se verifican acá (el schema no
    // los exige para permitir confirmar solo).
    const missing = REQUIRED_CREATE_FIELDS.filter((f) => args[f] === undefined || args[f] === null);
    if (missing.length > 0) {
      return {
        error: `Faltan datos obligatorios para crear el producto: ${missing.join(', ')}.`,
      };
    }
    // A partir de acá los 4 obligatorios están presentes (chequeado arriba).
    const complete = args as z.infer<typeof crearProductoSchema> & {
      nombre: string;
      fecha_compra: string;
      tipo_compra: PurchaseType;
      precio: number;
    };

    const similar = await this.findSimilar(userId, complete.nombre, complete.fecha_compra);
    if (similar.length > 0) {
      // Guarda los argumentos ORIGINALES para el turno de confirmación.
      this.pendingConfirmations.set(key, { args: complete, createdAt: Date.now() });
      return {
        needs_confirmation: true,
        message: `Ya existe un producto llamado "${complete.nombre}" con la misma fecha de compra. ¿Lo creo igual?`,
        similar: similar.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          fecha_compra: p.fecha_compra.toISOString().slice(0, 10),
          precio: p.precio.toString(),
          moneda: p.moneda,
        })),
      };
    }

    // Sin duplicados: crea directo y descarta cualquier pendiente viejo (el
    // flujo del usuario avanzó hacia otro producto).
    this.pendingConfirmations.delete(key);
    return this.createProductFromArgs(userId, complete);
  }

  /** Crea el producto con argumentos ya validados (los actuales o los pendientes). */
  private async createProductFromArgs(userId: string, args: z.infer<typeof crearProductoSchema>) {
    let fechaVencimiento: Date | null = null;
    if (args.duracion_garantia_meses) {
      // Misma convención que products.service.create: aritmética de meses en
      // UTC para que el día resultante no dependa de la zona horaria.
      // Los obligatorios están garantizados por los callers (ver crearProducto).
      fechaVencimiento = new Date(`${args.fecha_compra!}T00:00:00Z`);
      fechaVencimiento.setUTCMonth(fechaVencimiento.getUTCMonth() + args.duracion_garantia_meses);
    }

    // Categoría por nombre: resuelve (usuario + sistema, case-insensitive) o
    // crea una categoría personal si no existe — mismo patrón que importCsv.
    let categoriaId: string | null = null;
    if (args.categoria_nombre) {
      const cats = await this.prisma.category.findMany({
        where: { OR: [{ user_id: userId }, { user_id: null }] },
        select: { id: true, nombre: true },
      });
      const found = cats.find(
        (c) => c.nombre.toLowerCase() === args.categoria_nombre!.toLowerCase(),
      );
      if (found) {
        categoriaId = found.id;
      } else {
        const created = await this.prisma.category.create({
          data: { nombre: args.categoria_nombre, user_id: userId },
        });
        categoriaId = created.id;
      }
    }

    const product = await this.prisma.product.create({
      data: {
        user_id: userId,
        nombre: args.nombre!,
        marca: args.marca ?? null,
        modelo: args.modelo ?? null,
        descripcion: args.descripcion ?? null,
        fecha_compra: new Date(args.fecha_compra!),
        lugar_compra: args.lugar_compra ?? null,
        tipo_compra: args.tipo_compra as PurchaseType,
        precio: new Prisma.Decimal(args.precio!),
        moneda: args.moneda ?? 'USD',
        duracion_garantia_meses: args.duracion_garantia_meses ?? null,
        fecha_vencimiento_garantia: fechaVencimiento,
        notas: args.notas ?? null,
        categoria_id: categoriaId,
        metodo_pago: args.metodo_pago ?? null,
        numero_serie: args.numero_serie ?? null,
        tags: args.tags ?? null,
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

  /** Devuelve la confirmación pendiente de la conversación si existe y no expiró. */
  private getPending(key: string): PendingConfirmation | null {
    const pending = this.pendingConfirmations.get(key);
    if (!pending) return null;
    if (Date.now() - pending.createdAt > ChatToolExecutor.PENDING_TTL_MS) {
      this.pendingConfirmations.delete(key);
      return null;
    }
    return pending;
  }

  /**
   * Busca posibles duplicados para la confirmación consultiva: mismo nombre
   * (case-insensitive) y misma fecha de compra, sin borrados. Filtra en JS
   * para ser compatible con Postgres Y SQLite (mode: insensitive no existe
   * en SQLite); el pre-filtro usa ciContains para no traer todo el inventario.
   */
  private async findSimilar(userId: string, nombre: string, fechaCompra: string) {
    const candidates = await this.prisma.product.findMany({
      where: { user_id: userId, deleted_at: null, nombre: ciContains(nombre) },
      select: { id: true, nombre: true, fecha_compra: true, precio: true, moneda: true },
      take: 10,
    });
    return candidates.filter(
      (p) =>
        p.nombre.toLowerCase() === nombre.toLowerCase() &&
        p.fecha_compra.toISOString().slice(0, 10) === fechaCompra,
    );
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
