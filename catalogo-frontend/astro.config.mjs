// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  server: {
    host: true
  },
  devToolbar: {
    enabled: false
  },
  output: 'server',
  adapter: node({
    mode: 'standalone'
  })
});
