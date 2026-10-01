import { defineConfig } from 'vitest/config';

// Browser-side admin dashboard tests. They run in happy-dom (plain Node), not
// in the Workers runtime used by vitest.config.js, so the two suites never mix.
export default defineConfig({
  test: {
    name: 'dom',
    environment: 'happy-dom',
    globals: true,
    include: ['test/dom/**/*.test.js'],
    setupFiles: ['./test/dom/setup.js'],
    exclude: ['**/node_modules/**'],
    restoreMocks: true,
    unstubGlobals: true
  }
});
