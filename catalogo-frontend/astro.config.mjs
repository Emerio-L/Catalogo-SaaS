// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  server: {
    host: true
  },
  devToolbar: {
    enabled: false
  },
  output: 'server',
  adapter: vercel()
});
