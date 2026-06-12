// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  site: 'https://sedelynk.com',
  security: {
    // Railway terminates HTTPS before Astro; the API gateway validates Origin
    // against PUBLIC_SITE_URL so legitimate multipart uploads are not rejected.
    checkOrigin: false
  },
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
