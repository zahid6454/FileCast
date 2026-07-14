import { defineConfig } from 'vitest/config';

// JS unit tests (Phase 3). We run in the Node environment and spin up an
// isolated JSDOM window per test (see test/helpers.js), then eval the *source*
// JS file into it. This keeps production JS as clean CSP-safe IIFEs — no
// test-only exports shipped in the SRI'd bundle.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    globals: true
  }
});
