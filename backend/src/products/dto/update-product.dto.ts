// =============================================================================
// DTO: actualizar producto
// =============================================================================
// PartialType-like: todos los campos opcionales. Sin embargo, fecha_compra
// sigue siendo validable como fecha si se manda.
// =============================================================================

import { PartialType } from '@nestjs/mapped-types';
import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto extends PartialType(CreateProductDto) {}
