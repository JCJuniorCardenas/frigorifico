import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { InvoiceParserService } from './invoice-parser.service.js';
import { InvoiceParseError, type InvoiceParseErrorCode } from './parsed-invoice.js';

// El PDF real no se versiona (tiene datos de clientes): ver fixtures/README.md.
const FIXTURE = resolve(
  import.meta.dirname,
  '../../../../../fixtures/27252783119_001_00004_00000115.pdf',
);
const hasFixture = existsSync(FIXTURE);

function service(issuerCuit?: string): InvoiceParserService {
  const config = { get: vi.fn().mockReturnValue(issuerCuit) };
  return new InvoiceParserService(config as unknown as ConfigService);
}

/** Genera un PDF mínimo válido con una línea de texto por página (o sin texto). */
function buildPdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // número de objeto (1-based)

  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES_PLACEHOLDER');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageRefs: number[] = [];
  for (const lines of pages) {
    const stream = lines
      .map((line, i) => `BT /F1 10 Tf 20 ${780 - i * 14} Td (${line}) Tj ET`)
      .join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageRefs.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function expectParseError(
  promise: Promise<unknown>,
  code: InvoiceParseErrorCode,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(InvoiceParseError);
  expect((error as InvoiceParseError).code).toBe(code);
}

describe('InvoiceParserService', () => {
  describe.skipIf(!hasFixture)('con el PDF de ejemplo (fixtures/)', () => {
    it('extrae exactos los 14 campos y pasa todas las validaciones', async () => {
      const pdf = new Uint8Array(readFileSync(FIXTURE));
      const result = await service('27252783119').parse(pdf);

      expect(result.warnings).toEqual([]);
      expect(result.needsReview).toBe(false);
      const { invoice } = result;
      expect({
        salesPoint: invoice.salesPoint,
        voucherNumber: invoice.voucherNumber,
        issueDate: invoice.issueDate?.toISOString().slice(0, 10),
        paymentDueDate: invoice.paymentDueDate?.toISOString().slice(0, 10),
        clientCuit: invoice.clientCuit,
        clientName: invoice.clientName,
        herdNumber: invoice.herdNumber,
        slaughterKg: invoice.slaughterKg,
        totalAmount: invoice.totalAmount,
        netTaxedAmount: invoice.netTaxedAmount,
        vat21Amount: invoice.vat21Amount,
        exemptAmount: invoice.exemptAmount,
        cae: invoice.cae,
        caeDueDate: invoice.caeDueDate?.toISOString().slice(0, 10),
      }).toEqual({
        salesPoint: '00004',
        voucherNumber: '00000115',
        issueDate: '2026-11-12',
        paymentDueDate: '2026-11-12',
        clientCuit: '30714542431',
        clientName: 'LA BELGRANO SRL',
        herdNumber: '15005',
        slaughterKg: '811.00',
        totalAmount: '439211.86',
        netTaxedAmount: '348730.00',
        vat21Amount: '73233.30',
        exemptAmount: '17248.56',
        cae: '86462412597429',
        caeDueDate: '2026-11-22',
      });
      expect(invoice.issuerCuit).toBe('27252783119');
    });

    it('no modifica el buffer recibido (se puede guardar después de parsear)', async () => {
      const pdf = new Uint8Array(readFileSync(FIXTURE));
      const before = pdf.byteLength;
      await service().parse(pdf);
      expect(pdf.byteLength).toBe(before);
    });

    it('rechaza un PDF truncado', async () => {
      const pdf = new Uint8Array(readFileSync(FIXTURE)).slice(0, 2000);
      await expectParseError(service().parse(pdf), 'INVALID_PDF');
    });
  });

  it('rechaza un archivo que no es PDF', async () => {
    const notPdf = new TextEncoder().encode('esto no es un pdf, es texto plano');
    await expectParseError(service().parse(notPdf), 'INVALID_PDF');
  });

  it('rechaza un PDF sin texto (por ejemplo, un escaneo)', async () => {
    await expectParseError(service().parse(buildPdf([[]])), 'NO_TEXT');
  });

  it('rechaza un PDF con texto que no es una factura', async () => {
    const pdf = buildPdf([['Presupuesto de servicios', 'Total estimado: 1000']]);
    await expectParseError(service().parse(pdf), 'NOT_AN_INVOICE');
  });
});
