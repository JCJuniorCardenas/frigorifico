import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeCuit } from './cuit.js';
import { PAGES_TO_READ, parseInvoiceText } from './invoice-parser.js';
import type { InvoiceParseResult } from './parsed-invoice.js';
import { extractPdfText } from './pdf-text.js';

@Injectable()
export class InvoiceParserService {
  private readonly issuerCuit?: string;

  constructor(config: ConfigService) {
    const cuit = config.get<string>('ISSUER_CUIT');
    this.issuerCuit = cuit ? normalizeCuit(cuit) : undefined;
  }

  /** Lee el PDF y devuelve el borrador con advertencias. Lanza InvoiceParseError si no se puede. */
  async parse(pdf: Uint8Array): Promise<InvoiceParseResult> {
    const text = await extractPdfText(pdf, PAGES_TO_READ);
    return parseInvoiceText(text, { issuerCuit: this.issuerCuit });
  }
}
