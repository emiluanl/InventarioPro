// =============================================================================
// ProductAttachmentsController
// =============================================================================
// Rutas anidadas bajo /products/:productId/attachments para gestionar
// fotos, recibos y facturas de un producto. Verifica ownership del producto
// antes de cualquier operación.
// =============================================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttachmentType } from '../../generated/prisma/client';

import { ProductAttachmentsService } from './product-attachments.service';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';

@Controller('products/:productId/attachments')
export class ProductAttachmentsController {
  constructor(private readonly attachments: ProductAttachmentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.attachments.list(user.id, productId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { tipo?: string } = {},
  ) {
    if (!file) {
      throw new Error('No se envió ningún archivo. Usa el campo "file" en multipart/form-data.');
    }

    const tipo = this.parseTipo(body.tipo);
    return this.attachments.create(
      user.id,
      productId,
      {
        buffer: file.buffer,
        mime_type: file.mimetype,
        original_name: file.originalname,
      },
      tipo,
    );
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachments.remove(user.id, productId, attachmentId);
  }

  private parseTipo(value: string | undefined): AttachmentType {
    if (!value) return AttachmentType.FOTO;
    const upper = value.toUpperCase();
    if (upper === AttachmentType.FOTO) return AttachmentType.FOTO;
    if (upper === AttachmentType.RECIBO) return AttachmentType.RECIBO;
    if (upper === AttachmentType.FACTURA) return AttachmentType.FACTURA;
    return AttachmentType.FOTO;
  }
}
