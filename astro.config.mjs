import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sfSymbols from '@info-evry/astro-design/integrations/sf-symbols';

export default defineConfig({
  output: 'server',
  base: '/adhesion',
  adapter: cloudflare(),
  integrations: [sfSymbols()],
  compressHTML: true,
  vite: {
    build: {
      minify: 'esbuild',
      cssMinify: true
    }
  }
});
