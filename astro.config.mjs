import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Update `site` to your final domain. It powers canonical URLs and the sitemap.
export default defineConfig({
  site: 'https://www.thoughtsontheword.com',
  integrations: [sitemap()],
});
