import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sfSymbols from './design/src/integrations/sf-symbols';

export default defineConfig({
  output: 'server',
  base: '/adhesion',
  adapter: cloudflare({
    platformProxy: {
      enabled: true
    }
  }),
  integrations: [sfSymbols()],
  compressHTML: true,
  vite: {
    ssr: {
      external: ['node:async_hooks']
    },
    build: {
      minify: 'esbuild',
      cssMinify: true,
      rollupOptions: {
        output: {
          manualChunks: undefined
        }
      }
    }
  }
});
