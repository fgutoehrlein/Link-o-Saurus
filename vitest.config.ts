import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['extension/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
});
