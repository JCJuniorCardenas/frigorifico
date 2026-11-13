import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Los e2e comparten la base de datos: corren de a un archivo para no pisarse los totales.
    fileParallelism: false,
    // Los PDFs de los e2e van a una carpeta temporal, nunca al storage de desarrollo.
    // (Se fija acá porque la configuración se valida una sola vez al importar AppModule.)
    env: { STORAGE_LOCAL_DIR: join(tmpdir(), 'frigorifico-e2e-storage') },
  },
});
