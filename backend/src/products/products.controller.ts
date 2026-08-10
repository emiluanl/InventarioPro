// =============================================================================
// ProductsController - CRUD principal de productos
// =============================================================================
// Las rutas de attachments (fotos, recibos, facturas) viven en un controller
// separado que se monta en ProductsModule bajo /products/:productId/attachments.
// =============================================================================

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsQueryDto } from './dto/products-query.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ProductsQueryDto) {
    return this.products.list(user.id, query);
  }

  /** Descarga el inventario del usuario en CSV (respeta los filtros del listado). */
  @Get('export')
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query() query: ProductsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, content } = await this.products.exportCsv(user.id, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return content;
  }

  /** Importa productos desde un CSV (multipart, campo "file"). */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importCsv(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'No se envió ningún archivo. Usa el campo "file" en multipart/form-data.',
      );
    }
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('El archivo debe tener extensión .csv.');
    }
    return this.products.importCsv(user.id, file.buffer.toString('utf8'));
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.findOne(user.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.products.create(user.id, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.remove(user.id, id);
  }
}
