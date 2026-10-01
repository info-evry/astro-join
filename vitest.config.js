import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15_000,
    // test/dom/** needs a browser environment and runs via vitest.dom.config.js
    exclude: ['**/node_modules/**', 'test/dom/**'],
    setupFiles: ['./test/setup.js']
  },
  plugins: [
    cloudflareTest({
      main: './dist/server/entry.mjs',
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          ADMIN_EMAIL: 'test@example.com',
          REPLY_TO_EMAIL: 'reply@example.com',
          ADMIN_TOKEN: 'test-admin-token'
        }
      }
    })
  ]
});
