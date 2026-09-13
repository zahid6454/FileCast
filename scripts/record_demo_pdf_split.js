// Demo-video recorder for pdf-split specifically. Sibling to record_demo.js
// (the generic `ui_type: standard` driver), which this tool doesn't fit:
// pdf-split's converter JS (static/js/converters/pdf-split.js,
// showSplitResults()) empties #result's .result__actions and replaces the
// single #download-btn with one "Download Splits (N)" button that fires N
// real sequential downloads itself when clicked (staggered 300ms apart),
// so there is no #download-btn left to click once conversion finishes, and
// a single click still needs to be shown producing N separate files, not
// folded into one generic confirmation. Also drives the "at marked points"
// split sub-mode (shared-page-grid.js) so the demo shows an actual 2-way
// split, not just "every page its own file". Reuses the same
// upload/cursor/capture/mux pipeline via scripts/lib/demo-record-shared.js.
//
// Not part of the app or CI - scratch tooling for producing demo clips.
//
// Usage: node scripts/record_demo_pdf_split.js <sample-pdf> <out-dir>
// Example:
//   node scripts/record_demo_pdf_split.js scratch-demo-videos/sample-guide.pdf scratch-demo-videos

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const {
  toFileUrl, moveCursor, clickRipple, centerOf, showDownloadToast,
  dragFileIntoUploadZone,
  startScreencast, muxFrames,
} = require('./lib/demo-record-shared');

const PDFTOPPM = process.env.PDFTOPPM_BIN || 'pdftoppm';
const TOOL_PATH = '/convert/pdf-split/';
const VW = 1920, VH = 1200;

async function main() {
  const [samplePdf, outDir] = process.argv.slice(2);
  if (!samplePdf || !outDir) {
    console.error('Usage: node record_demo_pdf_split.js <sample-pdf> <out-dir>');
    process.exit(1);
  }

  const framesDir = path.join(outDir, 'frames');
  let browser;
  let frames = [];
  try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });

  const screencast = await startScreencast(page, framesDir);
  frames = screencast.frames;

  // --- BEFORE: one PDF, scroll through it to show all 4 real pages ---
  // A pdf-split demo needs to establish "this is ONE file with 4 pages"
  // before the tool ever loads - a continuous-scroll layout (all 4 real
  // rasterized pages stacked top to bottom, like any PDF viewer) reads as
  // that directly; a static fan of pages read more like "4 separate
  // documents" (direct user feedback: "pdf split means 1 pdf having 4
  // pages. So a quick scroll to show 4 pages").
  const beforePrefix = path.join(path.resolve(outDir), 'before-page');
  execFileSync(PDFTOPPM, ['-png', '-r', '110', '-f', '1', '-l', '4', path.resolve(samplePdf), beforePrefix]);
  const beforeImgs = [1, 2, 3, 4].map((n) => `${beforePrefix}-${n}.png`);
  const beforeHtmlPath = path.join(path.resolve(outDir), 'before-preview.html');
  fs.writeFileSync(beforeHtmlPath, `<html><body style="margin:0;background:#e9edf2;font-family:system-ui">
    <div style="position:sticky;top:0;text-align:center;padding:16px 0;background:#e9edf2;font:600 14px system-ui;color:#1f2328;z-index:1">sample-guide.pdf &middot; 4 pages</div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:28px;padding:12px 0 300px">
      ${beforeImgs.map((img) => `<img src="${toFileUrl(img)}" style="width:640px;box-shadow:0 10px 24px rgba(0,0,0,.22);border:1px solid #d0d7de">`).join('')}
    </div>
  </body></html>`);
  await page.goto(toFileUrl(beforeHtmlPath), { waitUntil: 'load' });
  await page.waitForTimeout(900); // hold on page 1 first, so it reads before the scroll starts
  const scrollTarget = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), scrollTarget);
  await page.waitForTimeout(1800); // let the smooth scroll play out through pages 2-4
  await page.waitForTimeout(700); // hold on page 4 at the bottom

  // --- Drive the actual tool ---
  await page.goto('http://localhost:8000' + TOOL_PATH, { waitUntil: 'load' });

  const hasUploadZone = await page.locator('#upload-zone').count();
  const hasConvertBtn = await page.locator('#convert-btn').count();
  if (!hasUploadZone || !hasConvertBtn) {
    throw new Error(`${TOOL_PATH} is missing #upload-zone/#convert-btn - has the template changed?`);
  }

  await page.waitForTimeout(700);
  await dragFileIntoUploadZone(page, samplePdf);

  // The page-grid preview (shared-page-grid.js) now actually renders -
  // dragFileIntoUploadZone mirrors the drop onto #file-input's native
  // 'change' event for exactly this. Give it a beat to paint thumbnails.
  await page.locator('.page-grid').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1200);

  // Switch to "At marked points" and cut after page 2, so the split
  // actually produces 2 files (Pages 1-2, Pages 3-4) instead of the
  // every-page-its-own-file default - a more useful demo of what this
  // tool is for.
  const markedBtn = page.locator('.page-grid__split-mode-btn', { hasText: 'At marked points' });
  const markedPos = await centerOf(markedBtn);
  await moveCursor(page, markedPos.x, markedPos.y, 500);
  await clickRipple(page, markedPos.x, markedPos.y);
  await markedBtn.click();
  await page.waitForTimeout(500);

  const cutToggle = page.locator('.page-grid__cut-toggle[aria-label="Toggle cut after page 2"]');
  const cutPos = await centerOf(cutToggle);
  await moveCursor(page, cutPos.x, cutPos.y, 500);
  await clickRipple(page, cutPos.x, cutPos.y);
  await cutToggle.click();
  await page.waitForTimeout(1000); // let the marked cut + updated status settle on screen

  const convertBtn = page.locator('#convert-btn');
  const convertPos = await centerOf(convertBtn);
  await moveCursor(page, convertPos.x, convertPos.y, 500);
  await clickRipple(page, convertPos.x, convertPos.y);
  await convertBtn.click();
  await page.locator('#result').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(900);

  // pdf-split's redesigned result panel (2026-09-14) replaced the old
  // one-button-per-file layout with a single "Download Splits (N)" button
  // (static/js/converters/pdf-split.js, showSplitResults()) that fires N
  // real sequential downloads itself (staggered 300ms apart via
  // setTimeout, each a synthetic <a download> click) - there's no longer
  // one button per file to click. One click on screen still needs to read
  // as "2 separate files came out," not 1 - collect both real `download`
  // events the single click triggers and show both as separate rows (see
  // showDownloadToast's array form below), instead of a single generic
  // confirmation that would hide there were 2.
  const downloadAllBtn = page.locator('.result__actions button.btn--success', { hasText: 'Download Splits' });
  const btnLabel = (await downloadAllBtn.textContent()).trim();
  const expectedCount = parseInt(btnLabel.match(/\((\d+)\)/)[1], 10);
  const btnPos = await centerOf(downloadAllBtn);
  await moveCursor(page, btnPos.x, btnPos.y, 500);
  await clickRipple(page, btnPos.x, btnPos.y);

  const savedPaths = [];
  await downloadAllBtn.click();
  for (let i = 0; i < expectedCount; i++) {
    const download = await page.waitForEvent('download', { timeout: 15000 });
    const savedPath = path.join(path.resolve(outDir), 'downloaded-' + download.suggestedFilename());
    await download.saveAs(savedPath);
    savedPaths.push({ path: savedPath, filename: download.suggestedFilename() });
    console.log('Downloaded result saved to:', savedPath);
  }
  await page.waitForTimeout(400); // let the button's own disabled->enabled state settle on screen

  await showDownloadToast(page, savedPaths.map((s) => s.filename));

  // --- AFTER: open both real split-out files, scroll to prove each has 2
  // real pages, not just show 1 page and imply the rest (direct user
  // request: "we have to scroll to show that after downloading we have
  // two pdfs with 2 pages each"). Two columns, one per downloaded file,
  // each a mini vertical stack of ITS OWN 2 rasterized pages - same
  // continuous-scroll technique as the BEFORE shot, scrolled once to
  // reveal page 2 of both files at the same time.
  const afterFiles = savedPaths.map((s) => {
    const prefix = path.join(path.resolve(outDir), 'after-page-' + path.basename(s.path, '.pdf'));
    execFileSync(PDFTOPPM, ['-png', '-r', '120', '-f', '1', '-l', '2', s.path, prefix]);
    return { imgs: [1, 2].map((n) => `${prefix}-${n}.png`), filename: s.filename };
  });
  const afterHtmlPath = path.join(path.resolve(outDir), 'after-preview.html');
  fs.writeFileSync(afterHtmlPath, `<html><body style="margin:0;background:#525659;font-family:system-ui">
    <div style="position:sticky;top:0;display:flex;justify-content:center;gap:64px;padding:16px 0;background:#525659;z-index:1">
      ${afterFiles.map((f) => `<div style="color:#fff;font:600 13px system-ui">${f.filename}</div>`).join('')}
    </div>
    <div style="display:flex;justify-content:center;gap:64px;padding:12px 0 300px">
      ${afterFiles.map((f) => `<div style="display:flex;flex-direction:column;align-items:center;gap:24px">
        ${f.imgs.map((img) => `<img src="${toFileUrl(img)}" style="width:420px;box-shadow:0 10px 24px rgba(0,0,0,.35)">`).join('')}
      </div>`).join('')}
    </div>
  </body></html>`);
  await page.goto(toFileUrl(afterHtmlPath), { waitUntil: 'load' });
  await page.waitForTimeout(900); // hold on page 1 of both files first
  const afterScrollTarget = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), afterScrollTarget);
  await page.waitForTimeout(1800); // scroll down to page 2 of both
  await page.waitForTimeout(700); // hold on page 2 of both

  await screencast.stop();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const outMp4 = path.join(outDir, 'pdf-split-demo.mp4');
  muxFrames(frames, outMp4);
  console.log('Final video:', outMp4);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
