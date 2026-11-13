import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { MAX_PDF_BYTES, type UploadedFileLike, validateUploadedPdf } from './uploaded-pdf.js';

function file(overrides: Partial<UploadedFileLike> = {}): UploadedFileLike {
  const buffer = overrides.buffer ?? Buffer.from('%PDF-1.4\ncontenido');
  return {
    originalname: 'factura.pdf',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
    ...overrides,
  };
}

describe('validateUploadedPdf', () => {
  it('acepta un PDF válido y calcula su sha256', () => {
    const result = validateUploadedPdf(file());
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data.byteLength).toBe(18);
    // El hash depende solo del contenido.
    expect(validateUploadedPdf(file({ originalname: 'otro.PDF' })).hash).toBe(result.hash);
  });

  it('rechaza si no hay archivo o está vacío', () => {
    expect(() => validateUploadedPdf(undefined)).toThrow(BadRequestException);
    expect(() => validateUploadedPdf(file({ buffer: Buffer.alloc(0), size: 0 }))).toThrow(
      BadRequestException,
    );
  });

  it('rechaza archivos de más de 5 MB', () => {
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_PDF_BYTES)]);
    expect(() => validateUploadedPdf(file({ buffer: big, size: big.length }))).toThrow(
      PayloadTooLargeException,
    );
  });

  it('rechaza otra extensión', () => {
    expect(() => validateUploadedPdf(file({ originalname: 'factura.txt' }))).toThrow(
      /extensión \.pdf/,
    );
  });

  it('rechaza otro tipo MIME', () => {
    expect(() => validateUploadedPdf(file({ mimetype: 'image/png' }))).toThrow(/tipo de archivo/);
  });

  it('rechaza un archivo .pdf que no empieza con %PDF', () => {
    const fake = Buffer.from('<html>no soy un pdf</html>');
    expect(() => validateUploadedPdf(file({ buffer: fake, size: fake.length }))).toThrow(
      /firma %PDF/,
    );
  });
});
