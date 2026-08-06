// =============================================================================
// AppModule - raíz de la aplicación
// =============================================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './common/redis.module';
import { StorageModule } from './common/storage.module';
import { CookiesModule } from './common/cookies.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { ChatModule } from './chat/chat.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { GlobalValidationPipe } from './common/pipes/global-validation.pipe';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    ThrottlerModule.forRoot([
      // Límite global por defecto (los endpoints específicos lo sobreescriben).
      { name: 'default', limit: 100, ttl: 60 * 1000 },
    ]),
    PrismaModule,
    RedisModule,
    StorageModule,
    CookiesModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    ChatModule,
  ],
  providers: [
    // Guard JWT aplicado de forma global: respeta @Public() para excluir rutas.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Rate limiting global (los @Throttle() específicos lo afinan).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Validación de DTOs global con class-validator.
    { provide: APP_PIPE, useClass: GlobalValidationPipe },
    // Filtro de excepciones que unifica el formato de respuesta.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Auditoría de acciones sensibles.
    { provide: 'AUDIT_INTERCEPTOR', useClass: AuditInterceptor },
  ],
})
export class AppModule {}
