import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { assertValidKey, StorageService } from './storage.service.js';

/** Guarda los archivos en una carpeta del disco (STORAGE_LOCAL_DIR). */
export class LocalStorageService extends StorageService {
  private readonly root: string;

  constructor(rootDir: string) {
    super();
    this.root = resolve(rootDir);
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    // Escritura atómica: primero a un temporal y después se renombra.
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  }

  async get(key: string): Promise<Readable | null> {
    const path = this.pathFor(key);
    try {
      await stat(path);
    } catch {
      return null;
    }
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    assertValidKey(key);
    const path = resolve(this.root, key);
    // Defensa extra: la ruta final tiene que quedar dentro de la carpeta raíz.
    if (!path.startsWith(this.root + sep)) {
      throw new Error(`Clave de storage fuera de la carpeta permitida: "${key}"`);
    }
    return path;
  }
}
