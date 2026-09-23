import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    // Integration tests share one database and TRUNCATE between cases, so they
    // must not run in parallel across files. The concurrency they exercise is
    // *inside* each test, not between them.
    fileParallelism: false,
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
  },
});
