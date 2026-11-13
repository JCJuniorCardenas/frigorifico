import { Module } from '@nestjs/common';
import { InvoiceParserService } from './parser/invoice-parser.service.js';

@Module({
  providers: [InvoiceParserService],
  exports: [InvoiceParserService],
})
export class InvoicesModule {}
