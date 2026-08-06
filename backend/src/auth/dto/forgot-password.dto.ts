// =============================================================================
// DTO: Solicitar recuperación de contraseña
// =============================================================================
// Por seguridad, SIEMPRE respondemos con el mismo mensaje ("si la cuenta
// existe, enviaremos un email") para no enumerar qué emails están registrados.
// =============================================================================

import { IsEmail, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'El email no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;
}
