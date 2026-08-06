// =============================================================================
// DTO: Refresh token
// =============================================================================
// El cliente envía el refresh token (leído normalmente desde una cookie
// httpOnly) para pedir un nuevo access token. El backend lo valida contra
// la tabla refresh_tokens y, si está vigente, emite uno nuevo.
// =============================================================================

import { IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @MinLength(20)
  refresh_token!: string;
}
