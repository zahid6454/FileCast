import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// P2 §23 (technical audit report) — axe-core accessibility audit on the four
// page types the report names: homepage, one local (client-side) tool page,
// one cloud (server-side) tool page, one category page. Not a Lighthouse run
// (no browser UI to drive one from here) — axe-core is the same rules engine
// Lighthouse's accessibility category is built on, run directly via
// Playwright instead. wcag2a/wcag2aa/wcag21a/wcag21aa mirrors what Lighthouse
// scores against.
//
// Ad units and third-party iframes are excluded from scope, not disabled:
// this dist/ build never has adsense/ga4 configured (no DB — see
// playwright.config.js), so there is nothing to exclude in practice, but the
// intent is that this audits FileCast's own markup, not Google's.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const PAGES = [
  { name: 'homepage', url: '/' },
  { name: 'local (client-side) tool — png-to-jpg', url: '/convert/png-to-jpg/' },
  { name: 'cloud (server-side) tool — docx-to-pdf', url: '/convert/docx-to-pdf/' },
  { name: 'category page — image-conversion', url: '/image-conversion/' }
];

// Post-merge audit fix. The original P2 §23 pass only ever ran axe-core
// against the site's default (light) rendering, which is what let a real
// dark-mode color-contrast regression ship in the very fix meant to close
// color-contrast findings: a couple of the light-mode fixes landed on CSS
// custom properties that swap value between the two themes (or, for one new
// property, don't exist in the dark scope at all), so "fixed in light mode"
// silently meant "broken in dark mode" for the same element. theme-init.js
// gates dark mode behind a signed-in localStorage choice for real visitors
// (`dark mode is a SIGNED-IN privilege`), but the CSS itself keys off
// `[data-theme="dark"]` alone — forcing that attribute directly is the
// correct way to audit the dark PALETTE without needing to drive the actual
// sign-in + toggle UI flow just to get there.
for (const theme of ['light', 'dark']) {
  for (const page_ of PAGES) {
    test(`axe-core: no violations on ${page_.name} (${theme} mode)`, async ({ page }) => {
      await page.goto(page_.url);
      if (theme === 'dark') {
        await page.evaluate(() => {
          document.documentElement.setAttribute('data-theme', 'dark');
        });
      }
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      const summary = results.violations.map(
        (v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) — ${v.helpUrl}`
      );
      expect(results.violations, summary.join('\n')).toEqual([]);
    });
  }
}
