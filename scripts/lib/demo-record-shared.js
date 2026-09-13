// Shared plumbing for scripts/record_demo*.js: CDP screencast capture,
// demo-style cursor/ripple/click choreography, and the frames->mp4 mux via
// ffmpeg. Split out once a second driver (record_demo_text.js, for the
// text-input tool template) needed the exact same capture/encode pipeline —
// duplicating it risked the two drifting (fade timings, HOLD_SEC, cursor
// visuals) out of sync with each other.
//
// Not part of the app or CI - scratch tooling for producing demo clips.

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const PDFTOPPM = process.env.PDFTOPPM_BIN || 'pdftoppm';

const MIME_MAP = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

// CDP's Page.startScreencast ignores deviceScaleFactor entirely - it always
// emits frames at plain CSS-pixel size regardless of DPR. The only real
// lever for more resolution is a bigger viewport outright.
const VW = 1920, VH = 1200;

function toFileUrl(p) {
  return 'file:///' + path.resolve(p).replace(/\\/g, '/');
}

// Demo-style cursor: a ring+dot (like Loom/Cursorful/etc.), not a bare
// arrow, moved via a real CSS transition so Chrome animates and repaints it
// naturally - CDP screencast captures those repaints on its own, no manual
// frame-stepping needed.
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

// Types a value into one of a tool's #tool-options fields (templates/
// tool.html renders each option as #opt-<id>) with the same cursor+ripple+
// real-keystrokes choreography every other typed field in this pipeline
// uses - so a demo for any `options:`-bearing standard tool (dimensions,
// quality, rotation degrees, ...) can show a real value being set instead
// of skipping straight to Convert with defaults.
async function fillToolOption(page, optId, value) {
  const field = page.locator('#opt-' + optId);
  const pos = await centerOf(field);
  await moveCursor(page, pos.x, pos.y, 450);
  await clickRipple(page, pos.x, pos.y);
  await field.click();
  await field.fill('');
  await field.pressSequentially(String(value), { delay: 45 });
}

async function centerOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// CDP screencast only ever captures page content, never browser chrome, so
// the real download-shelf/toast can't appear on screen no matter what. Show
// an honest, clearly-synthetic confirmation instead and have the cursor
// click through it, so the download reads as a real, deliberate action
// instead of an invisible jump straight to the result.
//
// filenames: a single filename (string) for a one-file download, or an
// array for a tool whose action produces several files from one click
// (e.g. pdf-split's "Download Splits (N)" button, which fires N real
// downloads in sequence) - renders one checkmark row per file instead of
// folding them into a single line, so it's visibly "N separate downloads
// happened," not one.
async function showDownloadToast(page, filenames) {
  const list = Array.isArray(filenames) ? filenames : [filenames];
  const toastPos = await page.evaluate((list) => {
    const t = document.createElement('div');
    t.id = '__demo_toast';
    t.style.cssText = 'position:fixed;top:20px;right:20px;background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:10px 16px;box-shadow:0 8px 24px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:6px;font:600 13px system-ui;color:#1f2328;z-index:99998;';
    t.innerHTML = list.map((filename) =>
      '<div style="display:flex;align-items:center;gap:8px"><span style="color:#2da44e;font-size:16px;line-height:1">✓</span><span>Downloaded ' + filename + '</span></div>'
    ).join('');
    document.body.appendChild(t);
    const b = t.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, list);
  await page.waitForTimeout(600);
  await moveCursor(page, toastPos.x, toastPos.y, 500);
  await clickRipple(page, toastPos.x, toastPos.y);
  await page.evaluate(() => {
    const t = document.getElementById('__demo_toast'); if (t) t.remove();
    const c = document.getElementById('__demo_cursor'); if (c) c.remove();
  });
  await page.waitForTimeout(300);
}

// Drags sampleFile onto page's `#upload-zone` with the full cursor+carried-
// file-card choreography (see record_demo.js's original comments for why
// each piece exists: setInputFiles has no visible transition, a bare cursor
// doesn't read as "a file," and a real drag must be one continuous
// transition with dragenter fired mid-flight, not two separate moves with a
// dead pause between them). Shared by every driver that starts from the
// standard drag-and-drop upload zone, regardless of what the tool does
// after Convert.
async function dragFileIntoUploadZone(page, sampleFile) {
  const fileBuffer = fs.readFileSync(path.resolve(sampleFile));
  const fileName = path.basename(sampleFile);
  const mimeType = MIME_MAP[path.extname(fileName).toLowerCase()] || 'application/octet-stream';

  const dataTransfer = await page.evaluateHandle(({ data, name, type }) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], name, { type }));
    return dt;
  }, { data: fileBuffer.toString('base64'), name: fileName, type: mimeType });

  const zone = page.locator('#upload-zone');
  const zoneBox = await zone.boundingBox();
  const approachX = zoneBox.x - 40;
  const approachY = zoneBox.y - 30;
  const zoneCenterX = zoneBox.x + zoneBox.width / 2;
  const zoneCenterY = zoneBox.y + zoneBox.height / 2;

  await initCursor(page, approachX - 220, approachY - 40);

  // A small text chip next to an arrow reads as "cursor with a tooltip,"
  // not "a file being carried" - real OS drag ghosts are a thumbnail of the
  // item itself. Make the dragged object unmistakably file-shaped: a
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

  // One continuous transition straight to the drop point - firing
  // dragenter/dragover mid-flight, not by stopping and restarting the
  // transition (see the module comment above for why that reads as two
  // separate drags).
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

  // Some standard-template tools (pdf-split, pdf-rotate, pdf-organize,
  // pdf-extract-pages, pdf-remove-pages) mount a read-only page-thumbnail
  // preview (shared-page-grid.js) that listens ONLY for #file-input's
  // native 'change' event (shared-page-grid.js:1133, onFilePicked) - a
  // real drag-and-drop drop never fires it (shared.js's own drop handler
  // calls onFileSelected(e.dataTransfer.files[0]) directly, never touching
  // #file-input). That's a real product gap (a genuine drag-and-drop
  // visitor never sees the preview either), not something to route around
  // silently - but a demo that skips it entirely misses a real, working
  // feature of these tools. Mirror the same file onto #file-input and fire
  // a real 'change' so any page-grid preview renders, exactly as it would
  // for a visitor who clicks to browse instead of dragging. No-ops on
  // tools with no #file-input.
  const hasFileInput = await page.locator('#file-input').count();
  if (hasFileInput) {
    await page.evaluate(({ data, name, type }) => {
      const input = document.getElementById('file-input');
      if (!input) return;
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], name, { type }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { data: fileBuffer.toString('base64'), name: fileName, type: mimeType });
  }
}

// Builds an "opened file" preview page for the AFTER shot and returns its
// file:// URL, ready for page.goto(). PDF output can't be shown via
// <embed>/goto (Playwright's headless-shell Chromium has no PDF plugin;
// real Chrome hits an unrelated CORS bug on the download XHR earlier in the
// flow) - rasterize page 1 with poppler instead. A raster output
// (JPG/PNG/WEBP) is already viewable as-is, no rasterization needed.
function renderAfterFilePreview(outDir, savedPath) {
  const isPdfOutput = path.extname(savedPath).toLowerCase() === '.pdf';
  let afterImg;
  if (isPdfOutput) {
    const afterPagePrefix = path.join(path.resolve(outDir), 'after-page-' + path.basename(savedPath, '.pdf'));
    execFileSync(PDFTOPPM, ['-png', '-r', '150', '-f', '1', '-l', '1', '-singlefile', savedPath, afterPagePrefix]);
    afterImg = afterPagePrefix + '.png';
  } else {
    afterImg = savedPath;
  }
  const afterHtmlPath = path.join(path.resolve(outDir), 'after-preview.html');
  fs.writeFileSync(afterHtmlPath, `<html><body style="margin:0;background:#525659;display:flex;align-items:center;justify-content:center;height:100vh">` +
    `<img src="${toFileUrl(afterImg)}" style="max-width:90%;max-height:90%;box-shadow:0 4px 20px rgba(0,0,0,.4)"></body></html>`);
  return toFileUrl(afterHtmlPath);
}

// Wires up CDP Page.startScreencast, writing each frame to framesDir and
// collecting { file, t } records for muxFrames() below. Returns the frames
// array (mutated in place by the listener) and a stop() to call once done.
async function startScreencast(page, framesDir) {
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const client = await page.context().newCDPSession(page);
  const frames = [];
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

  return {
    frames,
    async stop() {
      await client.send('Page.stopScreencast');
      await page.waitForTimeout(200); // let any in-flight frame ack land
    },
  };
}

// Builds an ffmpeg concat file (each frame displayed until the next one
// arrives) and encodes it to outMp4, with a held final frame + fade in/out +
// a uniform speed-up applied last so every segment compresses together.
function muxFrames(frames, outMp4) {
  if (frames.length < 2) {
    throw new Error('Not enough frames captured: ' + frames.length);
  }

  const outDir = path.dirname(outMp4);
  const concatPath = path.join(outDir, 'concat.txt');
  let concat = '';
  let totalDur = 0;
  for (let i = 0; i < frames.length; i++) {
    // The true last frame gets a small nominal duration here - NOT the real
    // end-hold, which is added deterministically below via tpad. (Giving the
    // last frame its real held duration directly via the concat demuxer's
    // documented last-entry workaround - repeat the file once more with no
    // duration - silently inherited an extra ~3.5s from the preceding entry
    // in this ffmpeg build, roughly doubling the intended hold. tpad
    // sidesteps it entirely and is exact.)
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

  const HOLD_SEC = 2.5; // deliberate pause on the final frame before the fade-out
  const finalDur = totalDur + HOLD_SEC;
  const fadeOutStart = Math.max(finalDur - 0.4, 0.1).toFixed(2);
  const SPEED = 1.25; // whole-video playback speed-up, applied last so every segment (content, hold, fades) compresses uniformly

  execFileSync(FFMPEG, [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
    // fps=30 MUST come before fade: fade's internal frame-based timing gets
    // it wrong fed directly by the concat demuxer's irregular,
    // duration-per-frame PTS (fade-on-raw-concat renders almost entirely
    // black; fade-after-fps-normalize is correct). tpad clones the last
    // frame for HOLD_SEC more, after fps-normalizing so its duration is
    // exact, before fade-out consumes the tail of it. setpts+fps at the end
    // speeds up the assembled video and resamples back to a clean 30fps CFR
    // (setpts alone changes the effective rate).
    '-vf', `fps=30,tpad=stop_mode=clone:stop_duration=${HOLD_SEC},fade=t=in:st=0:d=0.3,fade=t=out:st=${fadeOutStart}:d=0.4,setpts=PTS/${SPEED},fps=30`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-movflags', '+faststart',
    outMp4,
  ], { stdio: 'inherit' });
}

module.exports = {
  VW, VH,
  toFileUrl,
  initCursor, moveCursor, clickRipple, centerOf,
  showDownloadToast,
  fillToolOption,
  dragFileIntoUploadZone,
  renderAfterFilePreview,
  startScreencast,
  muxFrames,
};
