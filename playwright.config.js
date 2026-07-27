import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Local dev only - in CI these same env var names are injected directly by
// the workflow, so there's no .env.e2e file to load there and this is a
// harmless no-op.
dotenv.config({ path: '.env.e2e' });

const PORT = 4173;
// Must match vite.config.js's GITHUB_PAGES_BASE - the production build (what
// this suite runs against, not the dev server) always emits asset references
// under this path, and `vite preview` serves accordingly.
const BASE_PATH = '/asset-register/';
const baseURL = `http://localhost:${PORT}${BASE_PATH}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // The e2e Supabase project is a free-tier one (deliberately separate
  // from production - see CLAUDE.md) with tighter connection/rate limits
  // than a paid plan. This suite is small enough that running serially
  // costs only a few seconds, and even 2 workers produced genuine action
  // timeouts (e.g. the photo-upload spec) from requests queueing up
  // against it under concurrent load, not real bugs - confirmed by the
  // same spec passing reliably alone.
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Zero locally so a genuine flake is obvious immediately; 2 on CI so one
  // doesn't block a merge while still surfacing as a real failure if it
  // fails consistently.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    // Cheap to keep, expensive to be without when a CI-only failure needs
    // debugging - captured only on the failing attempt, not every run.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.js/,
    },
    {
      name: 'chromium',
      // The app targets Chrome on Windows and ChromeOS specifically (see
      // CLAUDE.md) - Firefox/WebKit coverage would just be CI minutes spent
      // on browsers nobody in the field actually uses.
      use: {
        ...devices['Desktop Chrome'],
        // Reuses the session the 'setup' project already logged in with -
        // specs that need to start unauthenticated (login.spec.js's invalid-
        // credentials case) override this per-test with test.use().
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  // Builds and serves the production bundle rather than running the dev
  // server - vite-plugin-pwa's service worker behaves differently in a dev
  // build, and the production bundle is what actually ships.
  webServer: {
    command: 'npm run build:e2e && npm run preview',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
