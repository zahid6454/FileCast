// Demo-video recorder for image-resize specifically. Sibling to
// record_demo.js (the generic `ui_type: standard` driver), which skips
// this tool's actual point: image-resize.yaml declares `options` (width/
// height), and static/js/converters/image-resize.js builds a genuine live
// preview (#image-resizer, live-updating canvas + "W x H px" dims text)
// the moment a file is dropped, that redraws as you type - the real
// feature worth showing, not just drag-convert-download. Reuses the same
// upload/cursor/capture/mux pipeline via scripts/lib/demo-record-shared.js.
//
// Not part of the app or CI - scratch tooling for producing demo clips.
//
// Usage: node scripts/record_demo_image_resize.js <sample-image> <out-dir>
// Example:
//   node scripts/record_demo_image_resize.js scratch-demo-videos/sample-photo.jpg scratch-demo-videos

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const {
  toFileUrl, moveCursor, clickRipple, centerOf, showDownloadToast,
  fillToolOption, dragFileIntoUploadZone,
  startScreencast, muxFrames,
} = require('./lib/demo-record-shared');

const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';
const TOOL_PATH = '/convert/image-resize/';
const TARGET_WIDTH = '800';
const VW = 1920, VH = 1200;

function realDimensions(imgPath) {
  const out = execFileSync(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
    imgPath,
  ]).toString().trim();
  const [w, h] = out.split(',');
  return { width: w, height: h };
}

async function main() {
  const [sampleImage, outDir] = process.argv.slice(2);
  if (!sampleImage || !outDir) {
    console.error('Usage: node record_demo_image_resize.js <sample-image> <out-dir>');
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

  // --- BEFORE: the source image's real content at its real dimensions ---
  const origDims = realDimensions(path.resolve(sampleImage));
  const beforeHtmlPath = path.join(path.resolve(outDir), 'before-preview.html');
  fs.writeFileSync(beforeHtmlPath, `<html><body style="margin:0;background:#e9edf2;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui">
    <img src="${toFileUrl(path.resolve(sampleImage))}" style="max-width:720px;max-height:70vh;box-shadow:0 10px 24px rgba(0,0,0,.22);border:1px solid #d0d7de">
    <div style="font:600 14px system-ui;color:#1f2328;margin-top:16px">sample-photo.jpg &middot; ${origDims.width} &times; ${origDims.height}</div>
  </body></html>`);
  await page.goto(toFileUrl(beforeHtmlPath), { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  // --- Drive the actual tool ---
  await page.goto('http://localhost:8000' + TOOL_PATH, { waitUntil: 'load' });

  const hasUploadZone = await page.locator('#upload-zone').count();
  const hasConvertBtn = await page.locator('#convert-btn').count();
  if (!hasUploadZone || !hasConvertBtn) {
    throw new Error(`${TOOL_PATH} is missing #upload-zone/#convert-btn - has the template changed?`);
  }

  await page.waitForTimeout(700);
  await dragFileIntoUploadZone(page, sampleImage);

  // image-resize.js wires its own 'drop' listener directly on #upload-zone
  // (unlike shared-page-grid.js's file-input-only gap seen on the pdf-*
  // tools) - the live preview builds from the real drop, no workaround
  // needed. #image-resizer starts as ".hidden" until the image decodes.
  const resizer = page.locator('#image-resizer');
  await resizer.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(900); // hold on the live preview at original size first

  // Type a real width - aspect-ratio lock is on by default, so height
  // fills in on its own and the live preview + dims text redraw live.
  await fillToolOption(page, 'width', TARGET_WIDTH);
  await page.waitForTimeout(1100); // let the live preview settle on the new size

  const convertBtn = page.locator('#convert-btn');
  const convertPos = await centerOf(convertBtn);
  await moveCursor(page, convertPos.x, convertPos.y, 500);
  await clickRipple(page, convertPos.x, convertPos.y);
  await convertBtn.click();
  await page.locator('#download-btn').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(900);

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

  // --- AFTER: the real downloaded file, captioned with its REAL measured
  // dimensions (ffprobe, not just the number we typed) - proves the resize
  // actually happened, not just that the tool echoed the input back.
  const newDims = realDimensions(savedPath);
  const afterHtmlPath = path.join(path.resolve(outDir), 'after-preview.html');
  fs.writeFileSync(afterHtmlPath, `<html><body style="margin:0;background:#525659;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui">
    <img src="${toFileUrl(savedPath)}" style="max-width:720px;max-height:70vh;box-shadow:0 4px 20px rgba(0,0,0,.4)">
    <div style="color:#fff;font:600 14px system-ui;margin-top:16px">${download.suggestedFilename()} &middot; ${newDims.width} &times; ${newDims.height}</div>
  </body></html>`);
  await page.goto(toFileUrl(afterHtmlPath), { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  await screencast.stop();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const outMp4 = path.join(outDir, 'image-resize-demo.mp4');
  muxFrames(frames, outMp4);
  console.log('Final video:', outMp4);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
