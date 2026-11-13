import type { Readable } from 'node:stream';

/**
 * Almacenamiento de PDFs. En desarrollo, disco local; en producción se puede cambiar por un
 * volumen persistente o un bucket S3-compatible implementando esta misma interfaz.
 */
export abstract class StorageService {
  /** Guarda el archivo bajo `key` (sobrescribe si existe). */
  abstract put(key: string, data: Uint8Array): Promise<void>;
  /** Devuelve el archivo como stream, o null si no existe. */
  abstract get(key: string): Promise<Readable | null>;
  /** Borra el archivo; no falla si no existe. */
  abstract delete(key: string): Promise<void>;
}

/** Claves permitidas: segmentos alfanuméricos separados por "/", sin "..". */
const VALID_KEY = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/;

export function assertValidKey(key: string): void {
  if (!VALID_KEY.test(key) || key.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`Clave de storage inválida: "${key}"`);
  }
}
