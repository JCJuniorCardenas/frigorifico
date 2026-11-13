import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Los e2e comparten la base de datos: corren de a un archivo para no pisarse los totales.
    fileParallelism: false,
  },
});
