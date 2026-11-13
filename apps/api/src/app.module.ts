import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { validateEnv } from './config/env.validation.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { StockModule } from './stock/stock.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Límite por defecto; las rutas sensibles (login, upload) usan ThrottlerGuard con su propio @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    StorageModule,
    AuthModule,
    UsersModule,
    InvoicesModule,
    CatalogModule,
    StockModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
