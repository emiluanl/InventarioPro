// =============================================================================
// ChatController
// =============================================================================
// Rate limit aplicado: 20 mensajes por minuto por usuario.
// =============================================================================

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('chat')
@UseGuards(ThrottlerGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Envía un mensaje a la IA y devuelve la respuesta. */
  @Post('message')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  send(@CurrentUser() user: AuthUser, @Body() dto: SendMessageDto) {
    return this.chat.sendMessage(user.id, dto.conversation_id, dto.message);
  }

  /** Lista las conversaciones del usuario. */
  @Get('conversations')
  list(@CurrentUser() user: AuthUser) {
    return this.chat.listConversations(user.id);
  }

  /** Devuelve los mensajes de una conversación. */
  @Get('conversations/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.getMessages(user.id, id);
  }
}
