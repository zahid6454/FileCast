import { expect, test } from '@playwright/test';

// Narrow-viewport content-clipping guard.
//
// At <=767px the site sets `html { overflow-x: clip }` so the off-canvas nav
// drawer can't produce a horizontal scrollbar. That clip is load-bearing, but it
// also means ordinary content that overflows is silently CUT OFF rather than
// merely causing a scrollbar — there is no way for the user to reach it. A
// plain "does the page scroll sideways?" check cannot see that failure.
//
// So assert the invariant that actually matters: every element extending past
// the viewport must be either (a) an intentionally off-canvas fixed panel, or
// (b) inside a box that scrolls, so its content is still reachable.

const WIDTHS = [320, 375, 480, 768, 1024, 1200, 1440];

// One page per template: standard (has a range slider), multi-file (slider +
// markdown tables), text-input (markdown tables), plus the homepage.
const PAGES = [
  '/',
  '/convert/image-compress/',
  '/convert/bulk-image-compress/',
  '/convert/json-to-yaml/'
];

async function unreachableOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const scrollableAncestor = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) return true;
      }
      return false;
    };
    return [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > vw + 1)
      .filter((el) => getComputedStyle(el).position !== 'fixed') // off-canvas drawer
      .filter((el) => !el.closest('.header__nav'))
      .filter((el) => !scrollableAncestor(el)) // reachable by scrolling its own box
      .map((el) => {
        const b = el.getBoundingClientRect();
        return `${el.tagName}.${String(el.className).slice(0, 30)} right=${Math.round(b.right)}/${vw}`;
      });
  });
}

for (const url of PAGES) {
  test(`no content is clipped off-viewport on ${url}`, async ({ page }) => {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(url);
      const clipped = await unreachableOverflow(page);
      expect(clipped, `${url} @${w}px clips: ${clipped.join(', ')}`).toEqual([]);
    }
  });
}

test('the slider read-out stays visible at the narrowest width', async ({ page }) => {
  // The regression this guards: `.tool-options__slider` is a flex item, and a
  // flex item defaults to min-width:auto — so without an explicit `min-width: 0`
  // the range input refuses to shrink below its UA intrinsic width and pushes
  // the value read-out off the edge, where the root clip hides it entirely.
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/convert/image-compress/');

  const value = page.locator('.tool-options__value').first();
  await expect(value).toBeVisible();

  const box = await value.boundingBox();
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box.right ?? box.x + box.width).toBeLessThanOrEqual(vw);

  // And the slider must remain a usable control, not shrunk to nothing.
  const slider = await page.locator('.tool-options__slider').first().boundingBox();
  expect(slider.width).toBeGreaterThan(30);
});
