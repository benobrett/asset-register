import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
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
