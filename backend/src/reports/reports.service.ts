// =============================================================================
// ReportsService - agregados de gasto
// =============================================================================
// Responde la pregunta estrella del README: "¿cuánto gasté este año en
// electrónica / ropa / etc.?". Dado un año (o todos), agrega los productos
// del usuario en:
//   - total + cantidad (y moneda dominante)
//   - por categoría (con nombre, "Sin categoría" para null)
//   - por mes (los 12 meses del año, para el gráfico)
//   - por moneda (transparencia: no sumamos monedas distintas en silencio)
//   - years: años disponibles del usuario (para el selector)
//
// Los productos borrados (deleted_at) se excluyen SIEMPRE. Las fechas se
// leen con getUTC* porque Prisma devuelve los campos @db.Date a medianoche
// UTC (usar getMonth() local desfasaría el mes según la zona horaria).
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';

const MONTH_LABELS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

export interface SpendingCategory {
  categoria_id: string | null;
  nombre: string;
  total: number;
  cantidad: number;
}

export interface SpendingMonth {
  mes: number;
  label: string;
  total: number;
  cantidad: number;
}

export interface SpendingCurrency {
  moneda: string;
  total: number;
  cantidad: number;
}

export interface SpendingReport {
  year: number | null;
  total: number;
  cantidad: number;
  currency: string;
  by_category: SpendingCategory[];
  by_month: SpendingMonth[];
  by_currency: SpendingCurrency[];
  years: number[];
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Gasto del usuario en `year` (o todos los años si year es undefined). */
  async spendingReport(userId: string, year?: number): Promise<SpendingReport> {
    const where: Prisma.ProductWhereInput = {
      user_id: userId,
      deleted_at: null,
    };
    if (year) {
      where.fecha_compra = {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      };
    }

    const [products, categories] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          categoria_id: true,
          precio: true,
          moneda: true,
          fecha_compra: true,
        },
      }),
      this.prisma.category.findMany({
        where: { OR: [{ user_id: userId }, { user_id: null }] },
        select: { id: true, nombre: true },
      }),
    ]);

    const categoryName = new Map<string, string>(categories.map((c) => [c.id, c.nombre]));

    // Agregación en JS: escala personal (cientos de productos), evita SQL crudo
    // y mantiene el cálculo portable entre motores.
    const byCategory = new Map<string, SpendingCategory>();
    const byMonth: SpendingMonth[] = MONTH_LABELS.map((label, i) => ({
      mes: i + 1,
      label,
      total: 0,
      cantidad: 0,
    }));
    const byCurrency = new Map<string, SpendingCurrency>();
    let total = 0;

    for (const p of products) {
      const price = Number(p.precio);
      total += price;

      const key = p.categoria_id ?? '__none__';
      const existing = byCategory.get(key);
      if (existing) {
        existing.total += price;
        existing.cantidad += 1;
      } else {
        byCategory.set(key, {
          categoria_id: p.categoria_id,
          nombre: p.categoria_id ? (categoryName.get(p.categoria_id) ?? 'Otra') : 'Sin categoría',
          total: price,
          cantidad: 1,
        });
      }

      const monthIdx = p.fecha_compra.getUTCMonth();
      byMonth[monthIdx].total += price;
      byMonth[monthIdx].cantidad += 1;

      const currency = p.moneda || 'USD';
      const cur = byCurrency.get(currency);
      if (cur) {
        cur.total += price;
        cur.cantidad += 1;
      } else {
        byCurrency.set(currency, { moneda: currency, total: price, cantidad: 1 });
      }
    }

    const byCategorySorted = [...byCategory.values()].sort((a, b) => b.total - a.total);
    const byCurrencySorted = [...byCurrency.values()].sort((a, b) => b.total - a.total);

    // Moneda dominante: la que acumula más gasto (para formatear el total).
    const currency = byCurrencySorted[0]?.moneda ?? 'USD';

    const years = await this.availableYears(userId);

    return {
      year: year ?? null,
      total,
      cantidad: products.length,
      currency,
      by_category: byCategorySorted,
      by_month: byMonth,
      by_currency: byCurrencySorted,
      years,
    };
  }

  /** Años con compras del usuario (para el selector), más reciente primero. */
  private async availableYears(userId: string): Promise<number[]> {
    const rows = await this.prisma.product.findMany({
      where: { user_id: userId, deleted_at: null },
      select: { fecha_compra: true },
    });
    const years = new Set(rows.map((r) => r.fecha_compra.getUTCFullYear()));
    return [...years].sort((a, b) => b - a);
  }
}
