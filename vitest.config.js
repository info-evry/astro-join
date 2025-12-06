import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    testTimeout: 15_000,
    exclude: ['**/node_modules/**', '**/design/**', '**/knowledge/**'],
    poolOptions: {
      workers: {
        main: './dist/_worker.js/index.js',
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          bindings: {
            ADMIN_EMAIL: 'test@example.com',
            REPLY_TO_EMAIL: 'reply@example.com',
            ADMIN_TOKEN: 'test-admin-token'
          }
        }
      }
    }
  }
});
