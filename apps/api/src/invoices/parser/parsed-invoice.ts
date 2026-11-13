/** Datos extraídos de una factura, todavía sin guardar (borrador para la pantalla de revisión). */
export interface ParsedInvoice {
  salesPoint: string | null;
  voucherNumber: string | null;
  issueDate: Date | null;
  paymentDueDate: Date | null;
  clientName: string | null;
  clientCuit: string | null;
  herdNumber: string | null;
  /** Decimales como string normalizado ("811.00"); nunca `number`. */
  slaughterKg: string | null;
  totalAmount: string | null;
  netTaxedAmount: string | null;
  vat21Amount: string | null;
  exemptAmount: string | null;
  cae: string | null;
  caeDueDate: Date | null;
  /** Datos de control (no se guardan como columnas). */
  issuerCuit: string | null;
  otherTaxesAmount: string | null;
  herdLines: HerdLine[];
}

export interface HerdLine {
  herdNumber: string;
  kg: string;
  unitPrice: string;
  subtotal: string;
}

export type ParseWarningCode =
  | 'FIELD_MISSING'
  | 'FIELD_INVALID'
  | 'MULTIPLE_HERDS'
  | 'TOTALS_MISMATCH'
  | 'HERD_SUBTOTAL_MISMATCH'
  | 'OTHER_VAT_RATES'
  | 'INVALID_CLIENT_CUIT'
  | 'ISSUER_CUIT_MISMATCH'
  | 'DUE_DATE_BEFORE_ISSUE'
  | 'COPIES_MISMATCH'
  | 'UNEXPECTED_PAGES';

export interface ParseWarning {
  code: ParseWarningCode;
  /** Mensaje para el usuario, en español. */
  message: string;
  /** Campo afectado, si corresponde (para resaltarlo en la pantalla de revisión). */
  field?: keyof ParsedInvoice;
}

export interface InvoiceParseResult {
  invoice: ParsedInvoice;
  warnings: ParseWarning[];
  /** true si hay advertencias: la factura debe revisarse antes de confiar en ella. */
  needsReview: boolean;
}

export type InvoiceParseErrorCode =
  'INVALID_PDF' | 'NO_TEXT' | 'NOT_AN_INVOICE' | 'UNSUPPORTED_TYPE';

/** Error que impide procesar el archivo (no es una advertencia: no hay borrador posible). */
export class InvoiceParseError extends Error {
  constructor(
    readonly code: InvoiceParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InvoiceParseError';
  }
}
