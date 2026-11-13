import { parseInvoiceText } from './invoice-parser.js';
import { InvoiceParseError, type ParseWarningCode } from './parsed-invoice.js';
import type { PdfText, TextLine } from './pdf-text.js';

// Datos ficticios (CUIT válidos inventados): estos tests no dependen del PDF real.
const ISSUER = '20000000001';
const CLIENT = '30500010912';

interface InvoiceTextOptions {
  copy?: string;
  code?: string;
  title?: string;
  voucher?: string;
  issueDate?: string;
  dueDate?: string;
  issuerCuit?: string;
  clientCuit?: string;
  clientName?: string;
  herdLines?: string[];
  net?: string;
  exempt?: string;
  vat21?: string;
  vat105?: string;
  otherTaxes?: string;
  total?: string;
  cae?: string | null;
}

/** Arma el texto de una página con la misma estructura que la factura de ARCA. */
function invoicePage(o: InvoiceTextOptions = {}): string[] {
  const lines = [
    o.copy ?? 'ORIGINAL',
    'A',
    `EMISOR DE PRUEBA ${o.title ?? 'FACTURA'}`,
    `COD. ${o.code ?? '01'}`,
    `Punto de Venta: 00004 Comp. Nro: ${o.voucher ?? '00000115'}`,
    `Razón Social: EMISOR DE PRUEBA Fecha de Emisión: ${o.issueDate ?? '12/11/2026'}`,
    `CUIT: ${o.issuerCuit ?? ISSUER}`,
    `Período Facturado Desde: 12/11/2026 Hasta: 12/11/2026 Fecha de Vto. para el pago: ${o.dueDate ?? '20/11/2026'}`,
    `CUIT: ${o.clientCuit ?? CLIENT} Apellido y Nombre / Razón Social: ${o.clientName ?? 'CLIENTE DE PRUEBA SA'}`,
    'Código Producto / Servicio Cantidad U. medida Precio Unit. % Bonif Subtotal Alicuota Subtotal c/IVA',
    ...(o.herdLines ?? [
      'Servicio faena tropa 15005 811,00 kg 430,00 0,00 348730,00 21% 421963,30',
    ]),
    'Tasa de inspección veterinaria 4,00 unidades 3777,14 0,00 15108,56 Exento 15108,56',
    'IPCVA 4,00 unidades 535,00 0,00 2140,00 Exento 2140,00',
    'Importe Otros Tributos: $ 0,00',
    `Importe Exento: $ ${o.exempt ?? '17248,56'}`,
    `Importe Neto Gravado: $ ${o.net ?? '348730,00'}`,
    'IVA 27%: $ 0,00',
    `IVA 21%: $ ${o.vat21 ?? '73233,30'}`,
    `IVA 10.5%: $ ${o.vat105 ?? '0,00'}`,
    'IVA 5%: $ 0,00',
    'IVA 2.5%: $ 0,00',
    'IVA 0%: $ 0,00',
    `Importe Otros Tributos: $ ${o.otherTaxes ?? '0,00'}`,
    `Importe Total: $ ${o.total ?? '439211,86'}`,
  ];
  if (o.cae !== null) lines.push(`CAE N°: ${o.cae ?? '86462412597429'}`);
  lines.push('Fecha de Vto. de CAE: 22/11/2026');
  return lines;
}

function toLines(texts: string[]): TextLine[] {
  return texts.map((text, i) => {
    const y = 800 - i * 12;
    return { y, text, items: [{ text, x: 20, y }] };
  });
}

function pdf(
  original: InvoiceTextOptions = {},
  copies: InvoiceTextOptions[] = [{ copy: 'DUPLICADO' }, { copy: 'TRIPLICADO' }],
): PdfText {
  const pages = [original, ...copies.map((c) => ({ ...original, ...c }))].map((o) =>
    toLines(invoicePage(o)),
  );
  return { pageCount: pages.length, pages };
}

function codes(result: ReturnType<typeof parseInvoiceText>): ParseWarningCode[] {
  return result.warnings.map((w) => w.code);
}

function parseError(fn: () => unknown): InvoiceParseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof InvoiceParseError) return error;
    throw error;
  }
  throw new Error('Se esperaba un InvoiceParseError');
}

describe('parseInvoiceText', () => {
  it('extrae los campos de una factura A correcta sin advertencias', () => {
    const result = parseInvoiceText(pdf(), { issuerCuit: ISSUER });
    expect(result.warnings).toEqual([]);
    expect(result.needsReview).toBe(false);
    expect(result.invoice).toMatchObject({
      salesPoint: '00004',
      voucherNumber: '00000115',
      clientName: 'CLIENTE DE PRUEBA SA',
      clientCuit: CLIENT,
      issuerCuit: ISSUER,
      herdNumber: '15005',
      slaughterKg: '811.00',
      totalAmount: '439211.86',
      netTaxedAmount: '348730.00',
      vat21Amount: '73233.30',
      exemptAmount: '17248.56',
      cae: '86462412597429',
    });
    expect(result.invoice.issueDate?.toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(result.invoice.paymentDueDate?.toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect(result.invoice.caeDueDate?.toISOString()).toBe('2026-11-22T00:00:00.000Z');
  });

  it('lee importes con separador de miles', () => {
    const result = parseInvoiceText(
      pdf({
        herdLines: [
          'Servicio faena tropa 20001 1.200,50 kg 1.000,00 0,00 1.200.500,00 21% 1.452.605,00',
        ],
        net: '1.200.500,00',
        vat21: '252.105,00',
        exempt: '17.248,56',
        total: '1.469.853,56',
      }),
    );
    expect(result.warnings).toEqual([]);
    expect(result.invoice).toMatchObject({
      herdNumber: '20001',
      slaughterKg: '1200.50',
      netTaxedAmount: '1200500.00',
      vat21Amount: '252105.00',
      exemptAmount: '17248.56',
      totalAmount: '1469853.56',
    });
  });

  it('con más de una tropa suma los kg y pide revisión', () => {
    const result = parseInvoiceText(
      pdf({
        herdLines: [
          'Servicio faena tropa 15005 811,00 kg 430,00 0,00 348730,00 21% 421963,30',
          'Servicio faena tropa 15006 100,50 kg 430,00 0,00 43215,00 21% 52290,15',
        ],
        net: '391945,00',
        vat21: '82308,45',
        total: '491502,01',
      }),
    );
    expect(codes(result)).toEqual(['MULTIPLE_HERDS']);
    expect(result.needsReview).toBe(true);
    expect(result.invoice.herdNumber).toBe('15005');
    expect(result.invoice.slaughterKg).toBe('911.50');
    expect(result.warnings[0].message).toContain('15005, 15006');
  });

  it('avisa si neto + IVA + exento + otros tributos no da el total', () => {
    const result = parseInvoiceText(pdf({ total: '439211,87' }));
    expect(codes(result)).toContain('TOTALS_MISMATCH');
    expect(result.needsReview).toBe(true);
  });

  it('incluye otros tributos en la suma del total', () => {
    const result = parseInvoiceText(pdf({ otherTaxes: '100,00', total: '439311,86' }));
    expect(result.warnings).toEqual([]);
    expect(result.invoice.otherTaxesAmount).toBe('100.00');
  });

  it('avisa si hay IVA de otras alícuotas (y lo suma para validar el total)', () => {
    const result = parseInvoiceText(pdf({ vat105: '1000,00', total: '440211,86' }));
    expect(codes(result)).toEqual(['OTHER_VAT_RATES']);
  });

  it('avisa si kg × precio unitario no da el subtotal de la línea de faena', () => {
    const result = parseInvoiceText(
      pdf({
        herdLines: ['Servicio faena tropa 15005 811,00 kg 430,00 0,00 348731,00 21% 421964,51'],
      }),
    );
    expect(codes(result)).toContain('HERD_SUBTOTAL_MISMATCH');
  });

  it('avisa si el CUIT del cliente no es válido', () => {
    const result = parseInvoiceText(pdf({ clientCuit: '30500010913' }));
    expect(codes(result)).toEqual(['INVALID_CLIENT_CUIT']);
  });

  it('toma como cliente el CUIT de la línea de la razón social, no el del emisor', () => {
    const result = parseInvoiceText(pdf());
    expect(result.invoice.issuerCuit).toBe(ISSUER);
    expect(result.invoice.clientCuit).toBe(CLIENT);
  });

  it('avisa si el emisor no es el frigorífico configurado', () => {
    const result = parseInvoiceText(pdf(), { issuerCuit: '27252783119' });
    expect(codes(result)).toEqual(['ISSUER_CUIT_MISMATCH']);
  });

  it('avisa si el vencimiento es anterior a la emisión', () => {
    const result = parseInvoiceText(pdf({ issueDate: '12/11/2026', dueDate: '11/11/2026' }));
    expect(codes(result)).toEqual(['DUE_DATE_BEFORE_ISSUE']);
    expect(result.warnings[0].message).toContain('11/11/2026');
  });

  it('distingue la fecha de vencimiento de pago de la del CAE', () => {
    const result = parseInvoiceText(pdf({ dueDate: '15/12/2026' }));
    expect(result.invoice.paymentDueDate?.toISOString()).toBe('2026-12-15T00:00:00.000Z');
    expect(result.invoice.caeDueDate?.toISOString()).toBe('2026-11-22T00:00:00.000Z');
  });

  it('avisa si el duplicado no coincide con el original', () => {
    const result = parseInvoiceText(
      pdf({}, [{ copy: 'DUPLICADO', total: '1,00' }, { copy: 'TRIPLICADO' }]),
    );
    expect(codes(result)).toEqual(['COPIES_MISMATCH']);
    expect(result.warnings[0].message).toContain('página 2');
  });

  it('avisa si el PDF no tiene 3 páginas', () => {
    const result = parseInvoiceText(pdf({}, []));
    expect(codes(result)).toEqual(['UNEXPECTED_PAGES']);
  });

  it('marca como faltante un campo que no aparece, sin descartar el resto', () => {
    const result = parseInvoiceText(pdf({ cae: null }));
    expect(result.invoice.cae).toBeNull();
    expect(result.invoice.totalAmount).toBe('439211.86');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'FIELD_MISSING', field: 'cae' }),
    ]);
  });

  it('marca como faltante la tropa si no hay línea de faena', () => {
    const result = parseInvoiceText(pdf({ herdLines: [] }));
    expect(result.invoice.herdNumber).toBeNull();
    expect(result.invoice.slaughterKg).toBeNull();
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'FIELD_MISSING', field: 'herdNumber' }),
    );
  });

  it('rechaza una Factura B', () => {
    const error = parseError(() => parseInvoiceText(pdf({ code: '06' })));
    expect(error.code).toBe('UNSUPPORTED_TYPE');
    expect(error.message).toContain('Factura B');
  });

  it('rechaza una Nota de Crédito A', () => {
    const error = parseError(() => parseInvoiceText(pdf({ code: '03', title: 'NOTA DE CREDITO' })));
    expect(error.code).toBe('UNSUPPORTED_TYPE');
    expect(error.message).toContain('Nota de Crédito A');
  });

  it('rechaza un PDF que no es un comprobante', () => {
    const error = parseError(() =>
      parseInvoiceText({ pageCount: 1, pages: [toLines(['Hola', 'Esto es una carta'])] }),
    );
    expect(error.code).toBe('NOT_AN_INVOICE');
  });

  it('rechaza un PDF sin texto (escaneo)', () => {
    const error = parseError(() => parseInvoiceText({ pageCount: 1, pages: [[]] }));
    expect(error.code).toBe('NO_TEXT');
  });
});
