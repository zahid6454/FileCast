// Demo-video recorder for text-input tools (`ui_type: text-input` in
// tools/*.yaml -> templates/tool-text.html - paste-based UI, no file
// drag-and-drop). Sibling to record_demo.js, which only drives the
// standard file-upload template; see its COMPATIBILITY note. Shares the
// same CDP-screencast capture + ffmpeg mux pipeline via
// scripts/lib/demo-record-shared.js.
//
// Not part of the app or CI - scratch tooling for producing demo clips.
//
// Usage: node scripts/record_demo_text.js <tool-path> <sample-text-file> <out-dir>
// Example:
//   node scripts/record_demo_text.js /convert/csv-to-json/ scratch-demo-videos/sample.csv scratch-demo-videos

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const {
  toFileUrl, initCursor, moveCursor, clickRipple, centerOf, showDownloadToast,
  startScreencast, muxFrames,
} = require('./lib/demo-record-shared');

const VW = 1920, VH = 1200;

async function main() {
  const [toolPath, sampleTextFile, outDir] = process.argv.slice(2);
  if (!toolPath || !sampleTextFile || !outDir) {
    console.error('Usage: node record_demo_text.js <tool-path> <sample-text-file> <out-dir>');
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

  // 'load' not 'networkidle': every tool page fires a background fetch to
  // api.filecast.org for the announcements banner, which has nothing to do
  // with the page being usable (see record_demo.js's identical comment).
  await page.goto('http://localhost:8000' + toolPath, { waitUntil: 'load' });

  const hasTextInput = await page.locator('#text-input').count();
  const hasConvertBtn = await page.locator('#convert-btn').count();
  if (!hasTextInput || !hasConvertBtn) {
    throw new Error(
      `${toolPath} doesn't use the text-input template this script drives ` +
      `(missing ${!hasTextInput ? '#text-input' : '#convert-btn'}). ` +
      `Check ui_type in tools/<slug>.yaml - only "text-input" is supported.`
    );
  }

  await page.waitForTimeout(700);

  const sampleText = fs.readFileSync(path.resolve(sampleTextFile), 'utf8').replace(/\r\n/g, '\n');

  const inputArea = page.locator('#text-input');
  const inputPos = await centerOf(inputArea);
  await initCursor(page, inputPos.x - 260, inputPos.y - 120);
  await moveCursor(page, inputPos.x, inputPos.y, 500);
  await clickRipple(page, inputPos.x, inputPos.y);
  await inputArea.click();

  // Real keystrokes (not .fill()) so the char/byte counter and any live
  // preview animate in, reading as someone actually typing rather than the
  // text just appearing.
  await inputArea.pressSequentially(sampleText, { delay: 12 });
  await page.waitForTimeout(500);

  const convertBtn = page.locator('#convert-btn');
  const convertPos = await centerOf(convertBtn);
  await moveCursor(page, convertPos.x, convertPos.y, 500);
  await clickRipple(page, convertPos.x, convertPos.y);
  await convertBtn.click();
  await page.locator('#text-result').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(900); // let the output settle on screen before revealing it fully

  // output_is_data_url tools whose result is an image (qr-code-generator,
  // barcode-generator, base64-to-image) show the REAL output as
  // #text-image-preview (tool-text.html), not the raw textarea - that data:
  // URL text is unreadable plumbing, not something worth stretching open.
  // Every other text-input tool has no image preview, so this just no-ops
  // into the existing stretch-the-textarea behavior for those.
  const hasImagePreview = await page.locator('#text-image-preview:not(.hidden)').count();
  if (hasImagePreview) {
    await page.locator('#text-image-preview').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200); // hold on the real rendered output image

    // The raw data: URL textarea sits right below the image, and
    // #download-btn below that - at the natural scroll position, the
    // button is only half-visible at the bottom edge. Scroll just enough
    // to bring the button fully into view (bottom of button + a little
    // breathing room), not all the way to the textarea's top - anchoring
    // there instead pushed the QR image itself out of frame (first pass:
    // ended up showing only the text output, not "the QR image, text
    // output and the download button" together, per direct user
    // feedback). This keeps everything in one frame before clicking it.
    const revealPos = await page.evaluate(() => {
      const btn = document.getElementById('download-btn');
      const r = btn.getBoundingClientRect();
      return Math.max(0, r.bottom + window.scrollY - window.innerHeight + 60);
    });
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), revealPos);
    await page.waitForTimeout(900); // let the scroll play out + hold with image+text+button all visible
  } else {
    // The output textarea's rendered height comes from CSS min-height:160px
    // (style.css) - max-height:400px only ever caps growth that something
    // else causes, and nothing else makes a plain <textarea> grow to fit its
    // content, so real usage just gets an internal scrollbar past 160px. A
    // demo viewer can't tell there's more below the fold from a scrollbar
    // alone, so set an explicit height (overriding both bounds) to the
    // content's real scrollHeight and stretch open to it before Download.
    await page.evaluate(() => {
      const output = document.getElementById('text-output');
      const editor = document.getElementById('text-output-editor');
      const gutter = editor ? editor.querySelector('.text-editor__gutter') : null;
      if (!output) return;
      const full = output.scrollHeight + 2; // +2: avoid re-clipping by a sub-pixel rounding gap
      output.style.transition = 'height .6s ease';
      output.style.maxHeight = 'none';
      output.style.height = full + 'px';
      if (gutter) {
        gutter.style.transition = 'height .6s ease';
        gutter.style.maxHeight = 'none';
        gutter.style.height = full + 'px';
      }
    });
    await page.waitForTimeout(600); // stretch animation
    await page.locator('#text-result').scrollIntoViewIfNeeded();
    await page.waitForTimeout(900); // hold on the fully-revealed result
  }

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

  // --- AFTER: open the real downloaded file, not just the on-page textarea ---
  // The on-page #text-output already shows the same bytes, but a viewer has
  // no way to tell that from a toast alone - record_demo.js's file-upload
  // flow proves the download is real by opening the actual saved file, and
  // this needs the same beat (direct user feedback: "you didn't show the
  // downloaded outcome"). A downloaded image file (qr-code-generator's
  // .svg, barcode-generator's, base64-to-image's) renders as an actual
  // <img> - dumping its raw markup/bytes into a text viewer would show
  // meaningless XML/binary instead of the real result a viewer recognizes.
  const IMAGE_EXTS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'];
  const isImageOutput = IMAGE_EXTS.includes(path.extname(savedPath).toLowerCase());
  const filePreviewPath = path.join(path.resolve(outDir), 'downloaded-file-preview.html');
  // width:480 (not just max-width) so a naturally tiny output - a QR/
  // barcode SVG's intrinsic size can be well under 150px - actually
  // displays large enough to read, not shrunk further by the container.
  // Vector output (svg) upscales losslessly; a larger raster image is
  // still capped by max-height so it doesn't blow past the frame.
  const bodyHtml = isImageOutput
    ? `<img src="${toFileUrl(savedPath)}" style="width:480px;max-width:90vw;max-height:70vh;height:auto;display:block;margin:24px auto">`
    : `<pre style="margin:0;padding:20px;overflow:auto;font:13px/1.5 'Consolas',monospace;color:#1f2328;white-space:pre-wrap">${fs.readFileSync(savedPath, 'utf8').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
  fs.writeFileSync(filePreviewPath, `<html><body style="margin:0;background:#e9edf2;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui">
    <div style="width:${isImageOutput ? 'auto' : '900px'};max-width:900px;max-height:80vh;background:#fff;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:12px 20px;border-bottom:1px solid #e1e4e8;display:flex;align-items:center;gap:8px;font:600 13px system-ui;color:#1f2328">
        <span style="color:#2da44e">&#9679;</span>${download.suggestedFilename()}
      </div>
      ${bodyHtml}
    </div>
  </body></html>`);
  await page.goto(toFileUrl(filePreviewPath), { waitUntil: 'load' });
  await page.waitForTimeout(1800); // real hold on the opened file before the tail-hold/fade kicks in

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
