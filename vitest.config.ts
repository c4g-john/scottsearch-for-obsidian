import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      'scottsearch:on-device-worker-source': fileURLToPath(new URL('./tests/fixtures/worker-source.ts', import.meta.url)),
    },
  },
  test: {
    coverage: { reporter: ['text', 'html'] },
    environment: 'node',
  },
});
