// =============================================================================
// DTO: suscribirse a Web Push
// =============================================================================
// El navegador envía su PushSubscription (endpoint + claves p256dh/auth).
// El endpoint debe ser https (los push services reales lo exigen); se permite
// http solo para localhost (tests y desarrollo).
// =============================================================================

import { IsNotEmpty, IsString, MaxLength, ValidateNested, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';

export class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  auth!: string;
}

export class SubscribePushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  endpoint!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

export class UnsubscribePushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  endpoint!: string;
}
