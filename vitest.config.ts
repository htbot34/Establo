import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
  },
});
