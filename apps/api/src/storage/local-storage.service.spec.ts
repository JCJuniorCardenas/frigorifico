import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { LocalStorageService } from './local-storage.service.js';

describe('LocalStorageService', () => {
  let dir: string;
  let storage: LocalStorageService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'frigorifico-storage-'));
    storage = new LocalStorageService(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('guarda, lee y borra un archivo', async () => {
    await storage.put('invoices/ab/abc.pdf', new TextEncoder().encode('%PDF-contenido'));
    expect(await readFile(join(dir, 'invoices', 'ab', 'abc.pdf'), 'utf8')).toBe('%PDF-contenido');

    const stream = await storage.get('invoices/ab/abc.pdf');
    expect(stream).not.toBeNull();
    expect(await text(stream!)).toBe('%PDF-contenido');

    await storage.delete('invoices/ab/abc.pdf');
    expect(await storage.get('invoices/ab/abc.pdf')).toBeNull();
  });

  it('devuelve null si el archivo no existe y borrar no falla', async () => {
    expect(await storage.get('invoices/no-existe.pdf')).toBeNull();
    await expect(storage.delete('invoices/no-existe.pdf')).resolves.toBeUndefined();
  });

  it.each(['../afuera.pdf', 'invoices/../../afuera.pdf', '/abs.pdf', 'a\\b.pdf', '', 'a//b'])(
    'rechaza la clave "%s"',
    async (key) => {
      await expect(storage.put(key, new Uint8Array([1]))).rejects.toThrow();
    },
  );
});
