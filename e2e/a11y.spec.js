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

for (const page_ of PAGES) {
  test(`axe-core: no violations on ${page_.name}`, async ({ page }) => {
    await page.goto(page_.url);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    const summary = results.violations.map(
      (v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) — ${v.helpUrl}`
    );
    expect(results.violations, summary.join('\n')).toEqual([]);
  });
}
