// =============================================================================
// Bootstrap del backend
// =============================================================================

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const port = Number(config.get<string>('PORT') ?? 3001);
  const apiPrefix = config.get<string>('API_PREFIX') ?? 'api';
  const corsOrigin = config.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000';
  const isProduction = (config.get<string>('NODE_ENV') ?? 'development') === 'production';

  // Seguridad HTTP: cabeceras estándar + CSP estricta en producción.
  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              connectSrc: ["'self'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Cookie parser para leer cookies httpOnly en el server.
  app.use(cookieParser());

  // CORS estricto: nunca usamos "*". Lista explícita por dominio.
  // credentials: true para que las cookies viajen en las requests cross-origin.
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count'],
  });

  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  await app.listen(port);
  logger.log(`InventarioPro backend escuchando en http://localhost:${port}/${apiPrefix}`);
  if (isProduction) {
    logger.log('Modo PRODUCCIÓN: cookies Secure activas, CSP estricto, logs de error.');
  } else {
    logger.warn('Modo DESARROLLO: cookies sin Secure, CSP relajado.');
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fallo crítico al arrancar el backend:', err);
  process.exit(1);
});
