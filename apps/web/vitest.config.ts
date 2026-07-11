import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// GOAL-RUN5 G5: unit tests for the pure wizard/catalog/i18n layers plus the
// mocked prefill service. Node environment on purpose — components stay
// untested here (Playwright E2E is TODOS.md #2), the logic lives in pure
// modules precisely so it can be tested without a DOM.
export default defineConfig({
  resolve: {
    alias: {
      '@': rootDir,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
