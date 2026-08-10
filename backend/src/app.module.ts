// =============================================================================
// AppModule - raíz de la aplicación
// =============================================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
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
import { BootstrapService } from './common/bootstrap.service';
import { HealthController } from './common/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    ThrottlerModule.forRoot([
      // ÚNICO throttler global. En @nestjs/throttler v6 TODOS los throttlers del
      // módulo se evalúan en TODAS las rutas (verificado empíricamente: un
      // nombre extra limita también /health), así que los límites por endpoint
      // se configuran con @Throttle({ default: {...} }) por ruta, que
      // sobreescribe estos valores. v6 genera un bucket por endpoint usando
      // la clave sha256(Clase+Handler+Nombre+IP), así que cada ruta es
      // independiente aunque comparta el nombre 'default'.
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
  controllers: [HealthController],
  providers: [
    // Guard JWT aplicado de forma global: respeta @Public() para excluir rutas.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Rate limiting global (los @Throttle() específicos lo afinan).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Validación de DTOs global con class-validator.
    { provide: APP_PIPE, useClass: GlobalValidationPipe },
    // Filtro de excepciones que unifica el formato de respuesta.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    BootstrapService,
  ],
})
export class AppModule {}
