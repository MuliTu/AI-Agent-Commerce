import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['evals/live/live-eval.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
