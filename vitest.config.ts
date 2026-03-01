import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 600000, // 10 min max for recursive workflows
    hookTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Prevent API rate limiting from parallel tests
      },
    },
  },
});
