import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import { InvoiceParseError } from './parsed-invoice.js';

/** Fragmento de texto con su posición (origen abajo a la izquierda, en puntos PDF). */
export interface PositionedText {
  text: string;
  x: number;
  y: number;
}

/** Línea reconstruida: fragmentos con la misma altura, ordenados de izquierda a derecha. */
export interface TextLine {
  y: number;
  text: string;
  items: PositionedText[];
}

export interface PdfText {
  pageCount: number;
  /** Líneas de cada página leída (de arriba hacia abajo). */
  pages: TextLine[][];
}

/**
 * Tolerancia vertical para considerar dos fragmentos en la misma línea. En las facturas de ARCA
 * una etiqueta y su valor pueden diferir 1-2 puntos (ej. "Punto de Venta:" en 749 y "00004" en 748).
 */
const SAME_LINE_TOLERANCE = 2.5;

/**
 * Extrae el texto de las primeras `maxPages` páginas, agrupado en líneas.
 * Solo lee texto: no ejecuta scripts ni evalúa código del PDF.
 */
export async function extractPdfText(data: Uint8Array, maxPages: number): Promise<PdfText> {
  const loadingTask = getDocument({
    // pdfjs transfiere (y vacía) el buffer que recibe: le pasamos una copia.
    data: data.slice(),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    verbosity: VerbosityLevel.ERRORS,
  });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch {
    await loadingTask.destroy();
    throw new InvoiceParseError('INVALID_PDF', 'El archivo no es un PDF válido o está dañado.');
  }

  try {
    const pages: TextLine[][] = [];
    const pagesToRead = Math.min(doc.numPages, maxPages);
    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items
        .filter((item): item is TextItem => 'str' in item && item.str.trim() !== '')
        .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }));
      pages.push(groupIntoLines(items));
      page.cleanup();
    }
    return { pageCount: doc.numPages, pages };
  } catch (error) {
    if (error instanceof InvoiceParseError) throw error;
    throw new InvoiceParseError('INVALID_PDF', 'No se pudo leer el contenido del PDF.');
  } finally {
    await loadingTask.destroy();
  }
}

/** Agrupa fragmentos por altura (con tolerancia) y los ordena de arriba hacia abajo. */
export function groupIntoLines(items: PositionedText[]): TextLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: PositionedText[] }[] = [];
  for (const item of sorted) {
    const current = lines.at(-1);
    if (current && Math.abs(current.y - item.y) <= SAME_LINE_TOLERANCE) {
      current.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  return lines.map((line) => {
    const lineItems = line.items.sort((a, b) => a.x - b.x);
    return { y: line.y, items: lineItems, text: lineItems.map((i) => i.text).join(' ') };
  });
}
