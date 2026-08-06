// =============================================================================
// DTO: crear producto
// =============================================================================

import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsInt,
  IsDateString,
  IsNotEmpty,
  MaxLength,
  Min,
  Max,
  IsPositive,
  IsISO4217CurrencyCode,
} from 'class-validator';
import { ProductStatus, PurchaseType } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  categoria_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  marca?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @IsDateString()
  fecha_compra!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  lugar_compra?: string;

  @IsEnum(PurchaseType)
  tipo_compra!: PurchaseType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Min(0.01)
  precio!: number;

  @IsOptional()
  @IsISO4217CurrencyCode()
  moneda?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  metodo_pago?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  numero_serie?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600) // 50 años máx
  duracion_garantia_meses?: number;

  @IsOptional()
  @IsDateString()
  fecha_vencimiento_garantia?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  estado?: ProductStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notas?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;
}
