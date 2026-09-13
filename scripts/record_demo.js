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
// tools). NOT compatible with `text-input` (34 tools: base64, minifiers,
// hash generator, HTML formatter, most dev-tools...), `multi-file` (5
// tools: has #upload-zone but no #download-btn, would hang), or
// `text-diff` (1 tool) - those templates use a paste-based or
// multi-result UI with no drag-and-drop file flow at all. Check a tool's
// ui_type in tools/<slug>.yaml before pointing this at it.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const PDFTOPPM = process.env.PDFTOPPM_BIN || 'pdftoppm';

function toFileUrl(p) {
  return 'file:///' + path.resolve(p).replace(/\\/g, '/');
}

// Demo-style cursor: a ring+dot (like Loom/Cursorful/etc.), not a bare
// arrow, moved via a real CSS transition so Chrome animates and repaints
// it naturally - CDP screencast captures those repaints on its own, no
// manual frame-stepping needed. Used for every click from here on;
// previously Convert/Download were clicked with no on-screen indicator.
async function initCursor(page, x, y) {
  await page.evaluate(({ x, y }) => {
    const style = document.createElement('style');
    style.textContent = '@keyframes __demo_ripple { from { transform: scale(.4); opacity: .9; } to { transform: scale(2.4); opacity: 0; } }';
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = '__demo_cursor';
    cursor.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:99999;pointer-events:none;transition:left .5s cubic-bezier(.4,0,.2,1), top .5s cubic-bezier(.4,0,.2,1);`;
    cursor.innerHTML =
      '<div style="position:absolute;left:-13px;top:-13px;width:26px;height:26px;border-radius:50%;border:2px solid rgba(47,111,237,.9);background:rgba(47,111,237,.12);box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>' +
      '<div style="position:absolute;left:-4px;top:-4px;width:8px;height:8px;border-radius:50%;background:#2f6fed;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>';
    document.body.appendChild(cursor);
  }, { x, y });
}

async function moveCursor(page, x, y, waitMs = 650) {
  await page.evaluate(({ x, y }) => {
    const el = document.getElementById('__demo_cursor');
    if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
  }, { x, y });
  await page.waitForTimeout(waitMs);
}

async function clickRipple(page, x, y, waitMs = 450) {
  await page.evaluate(({ x, y }) => {
    const r = document.createElement('div');
    r.style.cssText = `position:fixed;left:${x - 15}px;top:${y - 15}px;width:30px;height:30px;border-radius:50%;border:3px solid #2f6fed;pointer-events:none;z-index:99997;animation:__demo_ripple .5s ease-out forwards;`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 550);
  }, { x, y });
  await page.waitForTimeout(waitMs);
}

async function centerOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function main() {
  const [toolPath, sampleFile, beforeHtml, outDir] = process.argv.slice(2);
  if (!toolPath || !sampleFile || !beforeHtml || !outDir) {
    console.error('Usage: node record_demo.js <tool-path> <sample-file> <before-html> <out-dir>');
    process.exit(1);
  }

  const framesDir = path.join(outDir, 'frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  // CDP's Page.startScreencast ignores deviceScaleFactor entirely - it
  // always emits frames at plain CSS-pixel size regardless of DPR
  // (verified: window.devicePixelRatio reports 2 with deviceScaleFactor
  // set, but the captured PNG is still exactly viewport-sized). The only
  // real lever for more resolution is a bigger viewport outright.
  const VW = 1920, VH = 1200;
  // Declared outside the try so `finally` can always close it - without
  // this, a mid-flow failure (e.g. the #download-btn wait timing out, as
  // happened for real when the local API was briefly down) leaves an
  // orphaned headless Chromium process running.
  let browser;
  const frames = []; // { file, t } - t is Date.now() ms when the frame arrived; hoisted above the try so the encoding step below can still use it even though browser/page/client are try-scoped
  try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  const client = await page.context().newCDPSession(page);

  let frameIndex = 0;

  client.on('Page.screencastFrame', async (frame) => {
    const t = Date.now();
    const file = path.join(framesDir, String(frameIndex).padStart(5, '0') + '.png');
    fs.writeFileSync(file, Buffer.from(frame.data, 'base64'));
    frames.push({ file, t });
    frameIndex += 1;
    try {
      await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    } catch (e) {
      // session may already be stopping; ignore
    }
  });

  await client.send('Page.startScreencast', {
    format: 'png',
    quality: 100,
    maxWidth: VW,
    maxHeight: VH,
    everyNthFrame: 1,
  });

  // --- BEFORE: show the source document's real content ---
  await page.goto(toFileUrl(beforeHtml), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  // --- Drive the actual tool ---
  await page.goto('http://localhost:8000' + toolPath, { waitUntil: 'networkidle' });

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

  // setInputFiles bypasses the DOM entirely (no dragover highlight, file
  // appears with zero visible transition - the "it just popped up"
  // complaint). Simulate a real drag-and-drop instead: the dropzone has a
  // genuine `upload-zone--active` highlight on dragover (shared.js), so
  // this is an actual UI state, not a fake pause.
  const mimeMap = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  };
  const fileBuffer = fs.readFileSync(path.resolve(sampleFile));
  const fileName = path.basename(sampleFile);
  const mimeType = mimeMap[path.extname(fileName).toLowerCase()] || 'application/octet-stream';

  const dataTransfer = await page.evaluateHandle(({ data, name, type }) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], name, { type }));
    return dt;
  }, { data: fileBuffer.toString('base64'), name: fileName, type: mimeType });

  // Dispatching dragenter/dragover/drop back-to-back is instantaneous -
  // two static states (empty, then highlighted) with nothing moving on
  // screen in between, which doesn't read as "a file being dragged" to a
  // viewer. The highlight and the resulting upload are still the genuine
  // DOM flow; only the cursor graphic is synthetic (a standard demo-video
  // device, same as any screen-recorder's cursor-highlight overlay).
  const zone = page.locator('#upload-zone');
  const zoneBox = await zone.boundingBox();
  const approachX = zoneBox.x - 40;
  const approachY = zoneBox.y - 30;
  const zoneCenterX = zoneBox.x + zoneBox.width / 2;
  const zoneCenterY = zoneBox.y + zoneBox.height / 2;

  await initCursor(page, approachX - 220, approachY - 40);

  // A small text chip next to an arrow reads as "cursor with a tooltip,"
  // not "a file being carried" - real OS drag ghosts are a thumbnail of
  // the item itself. Make the dragged object unmistakably file-shaped: a
  // document card (page + folded corner + extension badge), carried as a
  // child of the cursor so it travels with it automatically.
  const ext = (path.extname(fileName).slice(1) || 'FILE').toUpperCase();
  await page.evaluate(({ fileName, ext }) => {
    const card = document.createElement('div');
    card.id = '__demo_dragged_file';
    card.style.cssText = 'position:absolute;left:14px;top:-128px;transform:rotate(-4deg);';
    card.innerHTML = `
      <div style="position:relative;width:96px;height:118px;background:#fff;border-radius:8px;
                  box-shadow:0 10px 24px rgba(0,0,0,.28);border:1px solid #e1e4e8;
                  display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:10px">
        <div style="position:absolute;top:0;right:0;width:0;height:0;border-style:solid;
                    border-width:0 16px 16px 0;border-color:transparent #f0f2f5 transparent transparent"></div>
        <div style="background:#2f6fed;color:#fff;font:700 11px system-ui;letter-spacing:.3px;
                    border-radius:4px;padding:3px 7px;margin-bottom:8px">${ext}</div>
        <div style="font:600 11px system-ui;color:#2a2f36;max-width:82px;overflow:hidden;
                    text-overflow:ellipsis;white-space:nowrap">${fileName}</div>
      </div>`;
    document.getElementById('__demo_cursor').appendChild(card);
  }, { fileName, ext });
  await page.waitForTimeout(150);

  // One continuous transition straight to the drop point. The earlier
  // two-leg version (move -> full stop while "holding" the highlight ->
  // move again) read as "drags halfway, stops, drags again" - because
  // that's literally what it was: two separate CSS transitions with a
  // real dead pause between them. Fire dragenter partway through this
  // single transition instead of stopping to do it - the highlight still
  // appears mid-flight, motion never actually halts until it lands.
  const dragMs = 500; // matches initCursor's `.5s` transition duration
  await page.evaluate(({ x, y }) => {
    const el = document.getElementById('__demo_cursor');
    if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
  }, { x: zoneCenterX, y: zoneCenterY });
  await page.waitForTimeout(Math.round(dragMs * 0.55));
  await zone.dispatchEvent('dragenter', { dataTransfer });
  await zone.dispatchEvent('dragover', { dataTransfer });
  await page.waitForTimeout(dragMs - Math.round(dragMs * 0.55));
  await page.waitForTimeout(200); // brief settle once it's actually landed
  await zone.dispatchEvent('drop', { dataTransfer });
  await page.evaluate(() => { const f = document.getElementById('__demo_dragged_file'); if (f) f.remove(); });
  await page.waitForTimeout(300);

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

  // CDP screencast only ever captures page content, never browser chrome
  // (same reason the native file-picker dialog can't be shown - confirmed
  // earlier) - so Chrome's real download-shelf/toast can't appear on
  // screen no matter what. Show an honest, clearly-synthetic confirmation
  // instead and have the cursor click through it, so the download reads
  // as a real, deliberate action instead of an invisible jump straight to
  // the result.
  const toastPos = await page.evaluate((filename) => {
    const t = document.createElement('div');
    t.id = '__demo_toast';
    t.style.cssText = 'position:fixed;top:20px;right:20px;background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:10px 16px;box-shadow:0 8px 24px rgba(0,0,0,.22);display:flex;align-items:center;gap:8px;font:600 13px system-ui;color:#1f2328;z-index:99998;';
    t.innerHTML = '<span style="color:#2da44e;font-size:16px;line-height:1">✓</span><span>Downloaded ' + filename + '</span>';
    document.body.appendChild(t);
    const b = t.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, download.suggestedFilename());
  await page.waitForTimeout(600);
  await moveCursor(page, toastPos.x, toastPos.y, 500);
  await clickRipple(page, toastPos.x, toastPos.y);
  await page.evaluate(() => {
    const t = document.getElementById('__demo_toast'); if (t) t.remove();
    const c = document.getElementById('__demo_cursor'); if (c) c.remove();
  });
  await page.waitForTimeout(300);

  // --- AFTER: show the real converted file's actual page content ---
  // Playwright's bundled headless-shell Chromium has no PDF plugin (an
  // <embed>/goto both fail: "Couldn't load plugin" / treated as a
  // download), and the real installed Chrome hits an unrelated CORS bug
  // on the download XHR earlier in this flow. Sidestep both by rasterizing
  // the real downloaded PDF's first page with poppler and showing it as a
  // plain image - no plugin needed, same browser as the rest of the flow.
  const afterPagePrefix = path.join(path.resolve(outDir), 'after-page');
  execFileSync(PDFTOPPM, ['-png', '-r', '150', '-f', '1', '-l', '1', '-singlefile', savedPath, afterPagePrefix]);
  const afterImg = afterPagePrefix + '.png';
  const afterHtmlPath = path.join(path.resolve(outDir), 'after-preview.html');
  fs.writeFileSync(afterHtmlPath, `<html><body style="margin:0;background:#525659;display:flex;align-items:center;justify-content:center;height:100vh">` +
    `<img src="${toFileUrl(afterImg)}" style="max-width:90%;max-height:90%;box-shadow:0 4px 20px rgba(0,0,0,.4)"></body></html>`);
  await page.goto(toFileUrl(afterHtmlPath), { waitUntil: 'load' });
  await page.waitForTimeout(800); // just enough to settle/paint one clean frame - the real hold is added deterministically below via tpad

  await client.send('Page.stopScreencast');
  await page.waitForTimeout(200); // let any in-flight frame ack land
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  if (frames.length < 2) {
    console.error('Not enough frames captured:', frames.length);
    process.exit(1);
  }

  // Build an ffmpeg concat file: each frame displayed until the next one
  // arrives. The true last frame gets a small nominal duration here - NOT
  // the real end-hold, which is added deterministically below via tpad
  // instead. (Tried giving the last frame its real held duration directly
  // via the concat demuxer's documented last-entry workaround - repeat the
  // file once more with no duration - but that repeated entry silently
  // inherited an extra ~3.5s from the preceding entry in this ffmpeg build,
  // roughly doubling the intended hold. Confirmed by testing without the
  // fade filter too, so it's a concat-demuxer quirk, not a fade issue.
  // tpad sidesteps it entirely and is exact.)
  const concatPath = path.join(outDir, 'concat.txt');
  let concat = '';
  let totalDur = 0;
  for (let i = 0; i < frames.length; i++) {
    const dur = i < frames.length - 1
      ? Math.max((frames[i + 1].t - frames[i].t) / 1000, 0.04)
      : 0.1;
    totalDur += dur;
    concat += `file '${path.resolve(frames[i].file).replace(/\\/g, '/')}'\n`;
    concat += `duration ${dur.toFixed(3)}\n`;
  }
  // concat demuxer quirk: last file's duration is ignored unless repeated.
  concat += `file '${path.resolve(frames[frames.length - 1].file).replace(/\\/g, '/')}'\n`;
  fs.writeFileSync(concatPath, concat);

  const HOLD_SEC = 2.5; // deliberate pause on the final (after-PDF) frame before the fade-out
  const finalDur = totalDur + HOLD_SEC;
  const fadeOutStart = Math.max(finalDur - 0.4, 0.1).toFixed(2);
  const SPEED = 1.25; // whole-video playback speed-up, applied last so every segment (content, hold, fades) compresses uniformly
  const outMp4 = path.join(outDir, path.basename(toolPath.replace(/\/+$/, '')) + '-demo.mp4');
  execFileSync(FFMPEG, [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
    // fps=30 MUST come before fade: fade's internal frame-based timing
    // gets it wrong fed directly by the concat demuxer's irregular,
    // duration-per-frame PTS (confirmed by testing - fade-on-raw-concat
    // renders almost entirely black; fade-after-fps-normalize is correct).
    // tpad clones the last frame for HOLD_SEC more, after fps-normalizing
    // so its duration is exact, before fade-out consumes the tail of it.
    // setpts+fps at the end speeds up the assembled video and resamples
    // back to a clean 30fps CFR (setpts alone changes the effective rate).
    '-vf', `fps=30,tpad=stop_mode=clone:stop_duration=${HOLD_SEC},fade=t=in:st=0:d=0.3,fade=t=out:st=${fadeOutStart}:d=0.4,setpts=PTS/${SPEED},fps=30`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-movflags', '+faststart',
    outMp4,
  ], { stdio: 'inherit' });

  console.log('Final video:', outMp4);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
