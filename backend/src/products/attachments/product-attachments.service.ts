// =============================================================================
// ProductAttachmentsService
// =============================================================================

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AttachmentType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService, FileInput } from '../../common/storage.service';

@Injectable()
export class ProductAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(userId: string, productId: string) {
    await this.assertOwned(userId, productId);
    return this.prisma.productAttachment.findMany({
      where: { product_id: productId },
      orderBy: { created_at: 'asc' },
    });
  }

  async create(userId: string, productId: string, file: FileInput, tipo: AttachmentType) {
    await this.assertOwned(userId, productId);

    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Archivo vacío o no enviado.');
    }

    // El StorageService valida MIME/extensión/tamaño y luego sube.
    const uploaded = await this.storage.upload(`products/${productId}`, file);

    return this.prisma.productAttachment.create({
      data: {
        product_id: productId,
        tipo,
        url: uploaded.url,
        nombre: uploaded.nombre,
        mime_type: uploaded.mime_type,
        tamano_bytes: uploaded.size_bytes,
      },
    });
  }

  async remove(userId: string, productId: string, attachmentId: string) {
    await this.assertOwned(userId, productId);

    const attachment = await this.prisma.productAttachment.findFirst({
      where: { id: attachmentId, product_id: productId },
    });
    if (!attachment) {
      throw new NotFoundException('Adjunto no encontrado.');
    }

    // Borramos de storage (best-effort) y de BD.
    try {
      await this.storage.delete(attachment.url);
    } catch {
      // Si falla el borrado en storage, seguimos y borramos la fila.
    }

    await this.prisma.productAttachment.delete({ where: { id: attachmentId } });
    return { message: 'Adjunto eliminado.' };
  }

  private async assertOwned(userId: string, productId: string): Promise<void> {
    const exists = await this.prisma.product.findFirst({
      where: { id: productId, user_id: userId, deleted_at: null },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Producto no encontrado.');
    }
  }
}
