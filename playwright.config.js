import { defineConfig, devices } from '@playwright/test';

// E2E smoke (Phase 3). Serves the built `dist/` over a plain static server.
// NOTE: this local server does NOT enforce the CSP in dist/_headers, so the
// "zero CSP console violations" / font-load checks are deploy-preview-only
// (Phase 7 — see 03-phase3 §9 step 8). Locally we assert no console *errors*
// and that the markup contract (SRI'd external JS, no inline handlers) works.
//
// Prereq: `python build.py` has produced dist/ before running these.
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8000',
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'python -m http.server 8000 --bind 127.0.0.1',
    cwd: 'dist',
    url: 'http://127.0.0.1:8000',
    reuseExistingServer: !process.env.CI,
    timeout: 60000
  }
});
