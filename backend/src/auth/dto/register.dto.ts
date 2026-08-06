// =============================================================================
// DTO: Registro de usuario
// =============================================================================
// Validación de entrada con class-validator. Es la PRIMERA línea de defensa
// contra payloads malformados; nunca confiar en el cliente.
// =============================================================================

import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'El email no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(128)
  // Exigimos combinación de letras y números para evitar contraseñas triviales.
  // El validator `isStrongPassword` de class-validator es más estricto pero
  // a veces rechaza contraseñas válidas con espacios; esta regla es razonable.
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, {
    message: 'La contraseña debe incluir letras y números.',
  })
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nombre!: string;
}
