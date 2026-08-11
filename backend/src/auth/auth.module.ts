// =============================================================================
// AuthModule
// =============================================================================
// Registra todos los servicios del módulo de autenticación.
// =============================================================================

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CookiesModule } from '../common/cookies.module';
import { parseTtlSeconds } from '../common/parse-ttl';

@Module({
  imports: [
    CookiesModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        // NÚMERO de segundos (un string se interpretaría como milisegundos).
        signOptions: { expiresIn: parseTtlSeconds(config.get<string>('JWT_ACCESS_TTL')) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, EmailService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
