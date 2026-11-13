import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

/** Configuración compartida entre main.ts y los tests e2e. */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  // Detrás del proxy de la plataforma (Railway, etc.): IP real del cliente para el rate limit.
  (app as NestExpressApplication).set('trust proxy', 1);
  (app as NestExpressApplication).disable('x-powered-by');

  // La API solo devuelve JSON y PDFs: CSP muy restrictiva y sin embebidos de otros sitios.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'self'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });
  app.enableShutdownHooks();
}
