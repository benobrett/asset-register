import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves a project site under /<repo-name>/, not the root —
// keyed on mode rather than command so it applies to `vite preview` too,
// not just `vite build`. `command` is 'serve' for *both* `vite dev` and
// `vite preview` (only `vite build` gets 'build'), so branching on that
// alone left preview serving everything at '/' while the build it's
// meant to serve had already baked in `/asset-register/...` asset
// references - every request 404'd into the SPA fallback. `mode`
// defaults to 'development' for dev and 'production' for both build and
// preview, so this correctly matches preview's base to whatever the
// build it's serving actually used.
const GITHUB_PAGES_BASE = '/asset-register/';

export default defineConfig(({ mode }) => ({
  base: mode === 'development' ? '/' : GITHUB_PAGES_BASE,
  build: {
    outDir: 'dist',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // The e2e build skips registering the service worker entirely.
      // autoUpdate's own update-check can reload the page out from under
      // a slower in-flight interaction (seen as Playwright reporting the
      // element it just clicked "detached from the DOM, retrying" for the
      // full timeout) - that's SW/app-shell behavior this suite already
      // doesn't faithfully test anyway (see CLAUDE.md's e2e limitations),
      // so it's not worth the flakiness here. Production is unaffected.
      injectRegister: mode === 'e2e' ? false : 'auto',
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
  test: {
    // Vitest otherwise picks up e2e/*.spec.js too (its default include glob
    // matches *.spec.js as well as *.test.js) and fails confusingly trying
    // to run Playwright specs as unit tests.
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
  },
}));
