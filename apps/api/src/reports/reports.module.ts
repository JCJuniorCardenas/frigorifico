import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { StockModule } from '../stock/stock.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Reportes del módulo de stock y dashboard general. */
@Module({
  imports: [StockModule, InvoicesModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
