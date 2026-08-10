// =============================================================================
// AppModule - raíz de la aplicación
// =============================================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { THROTTLER_CONFIG } from './common/throttler.config';
import { ThrottlerUserGuard } from './common/throttler-user.guard';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './common/redis.module';
import { StorageModule } from './common/storage.module';
import { CookiesModule } from './common/cookies.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { ChatModule } from './chat/chat.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { PushModule } from './push/push.module';
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
    ThrottlerModule.forRoot(THROTTLER_CONFIG),
    PrismaModule,
    RedisModule,
    StorageModule,
    CookiesModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    ChatModule,
    NotificationsModule,
    ReportsModule,
    PushModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guard JWT aplicado de forma global: respeta @Public() para excluir rutas.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Rate limiting global (los @Throttle() específicos lo afinan). Cuenta por
    // USUARIO en rutas autenticadas (req.user ya poblado por JwtAuthGuard, que
    // corre antes) y por IP en las públicas.
    { provide: APP_GUARD, useClass: ThrottlerUserGuard },
    // Validación de DTOs global con class-validator.
    { provide: APP_PIPE, useClass: GlobalValidationPipe },
    // Filtro de excepciones que unifica el formato de respuesta.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    BootstrapService,
  ],
})
export class AppModule {}
