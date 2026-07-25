import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves a project site under /<repo-name>/, not the root —
// only applied for `vite build`, not `vite dev`, so the local dev server
// still serves from / as normal.
const GITHUB_PAGES_BASE = '/asset-register/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? GITHUB_PAGES_BASE : '/',
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
        start_url: GITHUB_PAGES_BASE,
        scope: GITHUB_PAGES_BASE,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
      },
    }),
  ],
}));
