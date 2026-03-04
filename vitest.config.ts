import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 1800000, // 30 min max for PDF workflows with large tree traversal (700+ logs)
    hookTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Prevent API rate limiting from parallel tests
      },
    },
  },
});
