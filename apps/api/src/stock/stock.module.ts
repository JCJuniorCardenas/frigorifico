import { Module } from '@nestjs/common';
import { PurchasesService } from './purchases.service.js';
import { PurchasesController, StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

/** Stock como libro de movimientos e ingresos de mercadería. */
@Module({
  controllers: [StockController, PurchasesController],
  providers: [StockService, PurchasesService],
  exports: [StockService],
})
export class StockModule {}
