// =============================================================================
// DTO: enviar mensaje al chat
// =============================================================================

import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendMessageDto {
  /**
   * ID de la conversación existente. Si se omite, se crea una nueva.
   */
  @IsOptional()
  @IsString()
  conversation_id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;
}
