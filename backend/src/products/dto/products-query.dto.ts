// =============================================================================
// DTO: query params de GET /products
// =============================================================================
// Soporta paginación, filtros, búsqueda y orden. Validado por class-validator
// para que un cliente malicioso no inyecte params raros.
// =============================================================================

import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import { ProductStatus, PurchaseType } from '@prisma/client';

export enum WarrantyStatusFilter {
  VIGENTE = 'vigente',
  POR_VENCER = 'por_vencer',
  VENCIDA = 'vencida',
}

export enum SortBy {
  FECHA_COMPRA = 'fecha_compra',
  NOMBRE = 'nombre',
  PRECIO = 'precio',
  TIEMPO_POSESION = 'tiempo_posesion',
  CREATED_AT = 'created_at',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class ProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  estado?: ProductStatus;

  @IsOptional()
  @IsEnum(PurchaseType)
  tipo_compra?: PurchaseType;

  @IsOptional()
  @IsEnum(WarrantyStatusFilter)
  warranty_status?: WarrantyStatusFilter;

  @IsOptional()
  @IsString()
  fecha_desde?: string; // ISO date

  @IsOptional()
  @IsString()
  fecha_hasta?: string; // ISO date

  @IsOptional()
  @IsEnum(SortBy)
  sort_by: SortBy = SortBy.FECHA_COMPRA;

  @IsOptional()
  @IsEnum(SortOrder)
  sort_order: SortOrder = SortOrder.DESC;
}
