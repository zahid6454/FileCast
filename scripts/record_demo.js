// Demo-video pilot recorder. Drives a FileCast tool page end to end
// (show source doc -> upload -> convert -> download -> show result) and
// captures it via CDP screencast (lossless PNG frames) rather than
// Playwright's built-in video recorder, which is fixed-quality VP8 and
// visibly soft for text-heavy UI. Frames are muxed into an mp4 with ffmpeg
// afterwards, using each frame's real on-screen duration so static holds
// don't get collapsed or padded out incorrectly.
//
// Not part of the app or CI - scratch tooling for producing demo clips.
//
// Usage: node scripts/record_demo.js <tool-path> <sample-file> <before-html> <out-dir>
// Example:
//   node scripts/record_demo.js /convert/docx-to-pdf/ scratch-demo-videos/sample.docx scratch-demo-videos/sample-preview.html scratch-demo-videos
//
// COMPATIBILITY: only drives tools on the standard single-file template
// (`ui_type: standard` in tools/*.yaml -> templates/tool.html - 59 of 99
// tools) whose Convert produces exactly one #download-btn download. NOT
// compatible with `text-input` (34 tools: base64, minifiers, hash
// generator, HTML formatter, most dev-tools... - use record_demo_text.js
// instead), `multi-file` (5 tools: has #upload-zone but no #download-btn,
// would hang), `text-diff` (1 tool), or a `standard` tool whose JS replaces
// #download-btn with multiple result buttons (e.g. pdf-split - use
// record_demo_pdf_split.js). Check a tool's ui_type and converter JS in
// tools/<slug>.yaml before pointing this at it.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const {
  toFileUrl, moveCursor, clickRipple, centerOf, showDownloadToast,
  dragFileIntoUploadZone, renderAfterFilePreview,
  startScreencast, muxFrames,
} = require('./lib/demo-record-shared');

const VW = 1920, VH = 1200;

async function main() {
  const [toolPath, sampleFile, beforeHtml, outDir] = process.argv.slice(2);
  if (!toolPath || !sampleFile || !beforeHtml || !outDir) {
    console.error('Usage: node record_demo.js <tool-path> <sample-file> <before-html> <out-dir>');
    process.exit(1);
  }

  const framesDir = path.join(outDir, 'frames');
  // Declared outside the try so `finally` can always close it - without
  // this, a mid-flow failure (e.g. the #download-btn wait timing out, as
  // happened for real when the local API was briefly down) leaves an
  // orphaned headless Chromium process running.
  let browser;
  let frames = [];
  try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });

  const screencast = await startScreencast(page, framesDir);
  frames = screencast.frames;

  // --- BEFORE: show the source document's real content ---
  await page.goto(toFileUrl(beforeHtml), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  // --- Drive the actual tool ---
  // 'load' not 'networkidle': every tool page fires a background fetch to
  // api.filecast.org for the announcements banner, which can take 2+
  // seconds to settle and has nothing to do with the page being usable -
  // waiting on it just records several seconds of dead static footage.
  // The #upload-zone/#download-btn check right below confirms the page is
  // actually interactive before proceeding.
  await page.goto('http://localhost:8000' + toolPath, { waitUntil: 'load' });

  // Fail fast with a clear reason instead of a generic 30s+ Playwright
  // timeout: this script only understands the standard single-file
  // template (see COMPATIBILITY note above). Catches it here rather than
  // an hour into a batch run on the wrong tool.
  const hasUploadZone = await page.locator('#upload-zone').count();
  const hasDownloadBtn = await page.locator('#download-btn').count();
  if (!hasUploadZone || !hasDownloadBtn) {
    throw new Error(
      `${toolPath} doesn't use the standard single-file template this script drives ` +
      `(missing ${!hasUploadZone ? '#upload-zone' : '#download-btn'}). ` +
      `Check ui_type in tools/<slug>.yaml - only "standard" is supported.`
    );
  }

  await page.waitForTimeout(700);
  await dragFileIntoUploadZone(page, sampleFile);

  // Click Convert - previously done with no on-screen cursor at all, so
  // the button just changed state with no visible cause.
  const convertBtn = page.locator('#convert-btn');
  const convertPos = await centerOf(convertBtn);
  await moveCursor(page, convertPos.x, convertPos.y, 500);
  await clickRipple(page, convertPos.x, convertPos.y);
  await convertBtn.click();
  await page.locator('#download-btn').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(900);

  // Click Download - same visibility fix.
  const downloadBtn = page.locator('#download-btn');
  const downloadPos = await centerOf(downloadBtn);
  await moveCursor(page, downloadPos.x, downloadPos.y, 500);
  await clickRipple(page, downloadPos.x, downloadPos.y);
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await downloadBtn.click();
  const download = await downloadPromise;
  const savedPath = path.join(path.resolve(outDir), 'downloaded-' + download.suggestedFilename());
  await download.saveAs(savedPath);
  console.log('Downloaded result saved to:', savedPath);

  await showDownloadToast(page, download.suggestedFilename());

  // --- AFTER: show the real converted file's actual content ---
  const afterUrl = renderAfterFilePreview(outDir, savedPath);
  await page.goto(afterUrl, { waitUntil: 'load' });
  await page.waitForTimeout(800); // just enough to settle/paint one clean frame - the real hold is added deterministically below via tpad

  await screencast.stop();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const outMp4 = path.join(outDir, path.basename(toolPath.replace(/\/+$/, '')) + '-demo.mp4');
  muxFrames(frames, outMp4);
  console.log('Final video:', outMp4);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
