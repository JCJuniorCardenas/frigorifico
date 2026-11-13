import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceParserService } from './parser/invoice-parser.service.js';

@Module({
  controllers: [InvoicesController],
  providers: [InvoiceParserService, InvoicesService],
  exports: [InvoiceParserService],
})
export class InvoicesModule {}
