// =============================================================================
// Bootstrap del backend
// =============================================================================

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import * as path from 'node:path';

import { AppModule } from './app.module';
import { JsonLogger } from './common/json-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // En producción los logs salen como JSON de una línea (fáciles de grepear y
  // agregar); en desarrollo mantienen el formato legible de texto.
  const config = app.get(ConfigService);
  const isProduction = (config.get<string>('NODE_ENV') ?? 'development') === 'production';
  app.useLogger(new JsonLogger(isProduction));

  const logger = new Logger('Bootstrap');

  const port = Number(config.get<string>('PORT') ?? 3001);
  const apiPrefix = config.get<string>('API_PREFIX') ?? 'api';
  const corsOrigin = config.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000';

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

  // Sirve los archivos subidos con el provider 'local' (fotos, recibos,
  // facturas) en /uploads/<ruta>. Misma carpeta que StorageService:
  // LOCAL_UPLOAD_DIR (por defecto ./uploads). Con Supabase las URLs ya son
  // absolutas y firmadas, así que este directorio queda vacío.
  const uploadDir = path.resolve(config.get<string>('LOCAL_UPLOAD_DIR') ?? './uploads');
  app.useStaticAssets(uploadDir, {
    prefix: '/uploads/',
    maxAge: '1d',
    fallthrough: false,
    // El frontend (otro origen en dev: :3010 vs :3001) embebe estas imágenes
    // vía <img>. helmet() pone Cross-Origin-Resource-Policy: same-origin por
    // defecto y el navegador bloquea la carga (ERR_BLOCKED_BY_RESPONSE.
    // NotSameOrigin): la imagen se ve rota aunque la URL funcione al abrirla
    // en una pestaña nueva. Solo esta ruta sirve recursos pensados para
    // embeberse desde el frontend, así que relajamos CORP aquí y la API
    // conserva same-origin. En prod (dominio único) es irrelevante: todo
    // comparte origen.
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

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
  // La validación global ya la registra GlobalValidationPipe (APP_PIPE en
  // app.module.ts: whitelist + forbidNonWhitelisted + transform). No registrar
  // otro ValidationPipe aquí: validaría dos veces por request con settings
  // distintos (ambigüedad) y añadiría coste sin beneficio.

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
