import { createHash } from 'node:crypto';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export const MAX_PDF_BYTES = 5 * 1024 * 1024;

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ValidatedPdf {
  data: Uint8Array;
  hash: string;
  originalName: string;
}

const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');

/**
 * Valida el archivo subido antes de leerlo: que exista, extensión .pdf, tipo MIME, tamaño máximo
 * de 5 MB y firma "%PDF-" al comienzo. Devuelve los bytes y su hash sha256.
 */
export function validateUploadedPdf(file: UploadedFileLike | undefined): ValidatedPdf {
  if (!file || file.size === 0 || file.buffer.length === 0) {
    throw new BadRequestException('Tenés que adjuntar un archivo PDF.');
  }
  if (file.size > MAX_PDF_BYTES || file.buffer.length > MAX_PDF_BYTES) {
    throw new PayloadTooLargeException('El archivo supera el máximo de 5 MB.');
  }
  if (!file.originalname.toLowerCase().endsWith('.pdf')) {
    throw new BadRequestException('El archivo tiene que tener extensión .pdf.');
  }
  if (file.mimetype !== 'application/pdf') {
    throw new BadRequestException('El archivo no es un PDF (tipo de archivo incorrecto).');
  }
  if (!file.buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    throw new BadRequestException('El archivo no es un PDF válido (firma %PDF ausente).');
  }
  return {
    data: new Uint8Array(file.buffer),
    hash: createHash('sha256').update(file.buffer).digest('hex'),
    originalName: file.originalname,
  };
}
