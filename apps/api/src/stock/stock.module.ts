import { Module } from '@nestjs/common';
import { AdjustmentsService } from './adjustments.service.js';
import { PurchasesService } from './purchases.service.js';
import { PurchasesController, StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

/** Stock como libro de movimientos: ingresos, mermas y ajustes. */
@Module({
  controllers: [StockController, PurchasesController],
  providers: [StockService, PurchasesService, AdjustmentsService],
  exports: [StockService],
})
export class StockModule {}
