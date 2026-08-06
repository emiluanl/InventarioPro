// =============================================================================
// PrismaModule
// =============================================================================
// Módulo global que expone PrismaService al resto de la app.
// Se importa una sola vez en AppModule y queda disponible para inyección
// en cualquier service.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
