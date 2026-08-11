// =============================================================================
// ChatModule
// =============================================================================

import { Module } from '@nestjs/common';

import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { DeepSeekClient } from './DeepSeek/DeepSeek.client';
import { ChatToolExecutor } from './tools/tool-executor';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [ProductsModule],
  controllers: [ChatController],
  providers: [ChatService, DeepSeekClient, ChatToolExecutor],
  exports: [ChatService],
})
export class ChatModule {}
