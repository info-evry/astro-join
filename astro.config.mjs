import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  base: '/adhesion',
  adapter: cloudflare({
    platformProxy: {
      enabled: true
    }
  }),
  vite: {
    ssr: {
      external: ['node:async_hooks']
    }
  }
});
