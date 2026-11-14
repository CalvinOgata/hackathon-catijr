import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  // The shared workspace ships TypeScript sources, so bundle it in
  noExternal: ['@auction/shared'],
});
