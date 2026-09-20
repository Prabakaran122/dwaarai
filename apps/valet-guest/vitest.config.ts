import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // tsconfig.json sets jsx:"preserve" for Next's own compiler, which leaves
  // esbuild with no JSX transform. Name the automatic runtime explicitly so
  // test files do not each need a React import.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
