import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15_000,
    exclude: ['**/node_modules/**'],
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
