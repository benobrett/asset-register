import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Default only globs js/css/html — widened so the logo and the
        // self-hosted font actually precache for offline use too.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,ttf}'],
      },
      // No icons yet — add them under public/ before this is installed
      // as a home-screen app on the Chromebook.
      manifest: {
        name: 'Asset Register',
        short_name: 'Assets',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
      },
    }),
  ],
});
