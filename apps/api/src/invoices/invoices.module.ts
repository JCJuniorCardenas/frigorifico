import { Module } from '@nestjs/common';
import { InvoiceManagementService } from './invoice-management.service.js';
import { InvoiceQueryService } from './invoice-query.service.js';
import { InvoiceStatusService } from './invoice-status.service.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoiceParserService } from './parser/invoice-parser.service.js';

@Module({
  controllers: [InvoicesController],
  providers: [
    InvoiceParserService,
    InvoicesService,
    InvoiceQueryService,
    InvoiceStatusService,
    InvoiceManagementService,
  ],
  exports: [InvoiceParserService],
})
export class InvoicesModule {}
