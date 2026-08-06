// =============================================================================
// ProductsModule
// =============================================================================

import { Module } from '@nestjs/common';

import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductAttachmentsController } from './attachments/product-attachments.controller';
import { ProductAttachmentsService } from './attachments/product-attachments.service';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [CategoriesModule],
  controllers: [ProductsController, ProductAttachmentsController],
  providers: [ProductsService, ProductAttachmentsService],
  exports: [ProductsService],
})
export class ProductsModule {}
