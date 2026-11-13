/**
 * Generador de PDFs mínimos para tests: una línea de texto por renglón, fuente Helvetica.
 * Se codifica en latin1 para que "Emisión" o "N°" lleguen bien al lector.
 */
export function buildPdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);

  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // /Pages, se completa al final
  const font = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const pageRefs: number[] = [];
  for (const lines of pages) {
    const stream = lines
      .map((line, i) => `BT /F1 9 Tf 20 ${800 - i * 13} Td (${escapePdf(line)}) Tj ET`)
      .join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageRefs.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  objects[1] =
    `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] ` +
    `/Count ${pageRefs.length} >>`;

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
  return Buffer.from(out, 'latin1');
}

function escapePdf(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

export interface FakeInvoice {
  voucherNumber: string;
  herdNumber?: string;
  clientName?: string;
  /** Texto extra para cambiar el contenido (y el hash) sin cambiar los datos. */
  salt?: string;
}

/** Factura A ficticia con la misma estructura que las de ARCA (3 copias). */
export function buildFakeInvoicePdf(o: FakeInvoice): Buffer {
  const page = (copy: string) => [
    copy,
    'EMISOR DE PRUEBA FACTURA',
    'COD. 01',
    `Punto de Venta: 00099 Comp. Nro: ${o.voucherNumber}`,
    'Razón Social: EMISOR DE PRUEBA Fecha de Emisión: 12/11/2026',
    'CUIT: 20000000001',
    'Período Facturado Desde: 12/11/2026 Hasta: 12/11/2026 Fecha de Vto. para el pago: 20/11/2026',
    `CUIT: 30500010912 Apellido y Nombre / Razón Social: ${o.clientName ?? 'CLIENTE DE PRUEBA SA'}`,
    `Servicio faena tropa ${o.herdNumber ?? '90001'} 811,00 kg 430,00 0,00 348730,00 21% 421963,30`,
    'Tasa de inspección veterinaria 4,00 unidades 3777,14 0,00 15108,56 Exento 15108,56',
    'Importe Otros Tributos: $ 0,00',
    'Importe Exento: $ 17248,56',
    'Importe Neto Gravado: $ 348730,00',
    'IVA 21%: $ 73233,30',
    'Importe Otros Tributos: $ 0,00',
    'Importe Total: $ 439211,86',
    'CAE N°: 12345678901234',
    'Fecha de Vto. de CAE: 22/11/2026',
    ...(o.salt ? [`Ref ${o.salt}`] : []),
  ];
  return buildPdf([page('ORIGINAL'), page('DUPLICADO'), page('TRIPLICADO')]);
}
