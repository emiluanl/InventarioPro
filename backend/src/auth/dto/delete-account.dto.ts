// =============================================================================
// DTO: Eliminación de cuenta
// =============================================================================
// Operación destructiva e irreversible: exigimos la contraseña actual como
// confirmación de que es el dueño de la cuenta quien la solicita.
// =============================================================================

import { IsString, MinLength } from 'class-validator';

export class DeleteAccountDto {
  @IsString({ message: 'Debes confirmar con tu contraseña.' })
  @MinLength(1)
  password!: string;
}
