// =============================================================================
// DTO: Cambio de contraseña (usuario autenticado)
// =============================================================================
// Mismas reglas que el registro/reset: 8+ caracteres con letras y números.
// current_password confirma que quien pide el cambio es el dueño de la cuenta.
// =============================================================================

import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  @IsString({ message: 'La contraseña actual es obligatoria.' })
  current_password!: string;

  @IsString()
  @MinLength(8, { message: 'La nueva contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, {
    message: 'La nueva contraseña debe incluir letras y números.',
  })
  new_password!: string;
}
