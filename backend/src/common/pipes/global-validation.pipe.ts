// =============================================================================
// ValidationPipe global
// =============================================================================
// Usa class-validator + class-transformer en TODOS los DTOs entrantes.
//   - whitelist: elimina propiedades no declaradas en el DTO (anti mass-assignment).
//   - forbidNonWhitelisted: lanza error si llegan propiedades extra.
//   - transform: convierte tipos primitivos (por ejemplo "1" -> 1 si la firma es number).
// =============================================================================

import { ValidationPipe } from '@nestjs/common';

export class GlobalValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    });
  }
}
