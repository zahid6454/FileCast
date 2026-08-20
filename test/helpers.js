import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { JSDOM } from 'jsdom';
import { vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Build an isolated JSDOM window with the given <body> markup. Each test gets a
// fresh window (fresh localStorage, fresh DOM, no leaked listeners).
export function createDom(bodyHtml = '', { url = 'http://localhost/' } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`, {
    url,
    pretendToBeVisual: true,
    runScripts: 'outside-only'
  });
  polyfillArrayBuffer(dom.window);
  polyfillBlobText(dom.window);
  polyfillObjectURL(dom.window);
  polyfillTextCodec(dom.window);
  polyfillSubtleCrypto(dom.window);
  return dom;
}

// This jsdom version doesn't expose TextEncoder/TextDecoder on the window at
// all (they exist as real Node globals, just never attached to the jsdom
// global object) — converters that encode/decode UTF-8 by hand (Base64,
// JWT) call `new TextEncoder()`/`new TextDecoder()` as bare globals, which
// resolve against `dom.window` when eval'd via evalScript(), not Node's own
// global scope. Node's own implementation is spec-compliant (including the
// `fatal` decode option), so it's reused as-is rather than reimplemented.
function polyfillTextCodec(win) {
  if (typeof win.TextEncoder === 'function') return;
  win.TextEncoder = NodeTextEncoder;
  win.TextDecoder = NodeTextDecoder;
}

// jsdom's window.crypto has getRandomValues()/randomUUID() (real browsers'
// crypto.subtle predates jsdom's implementation) but no `.subtle` at all —
// Hash Generator's SHA-256 (crypto.subtle.digest) would throw
// "crypto.subtle is undefined" under evalScript() without this. Node's own
// webcrypto.subtle is the same spec-compliant SubtleCrypto interface real
// browsers expose, so it's reused as-is rather than reimplemented.
function polyfillSubtleCrypto(win) {
  if (win.crypto && win.crypto.subtle) return;
  win.crypto.subtle = webcrypto.subtle;
}

// This jsdom version doesn't implement URL.createObjectURL/revokeObjectURL at
// all (throws "not a function") — nearly every converter creates an object
// URL to feed an <img>/<a download> element. Real browsers hand back an
// opaque blob: URL; a fake but unique one is enough for every converter's
// actual usage (they never dereference it themselves, only jsdom's own
// Image/anchor internals would, and those are mocked separately).
let objectUrlCounter = 0;
function polyfillObjectURL(win) {
  if (typeof win.URL.createObjectURL === 'function') return;
  win.URL.createObjectURL = () => `blob:mock/${objectUrlCounter++}`;
  win.URL.revokeObjectURL = () => {};
}

// This jsdom version's Blob/File don't implement `.arrayBuffer()` (it throws
// "not a function") even though every browser has had it for years — several
// converters (pdf-split.js and friends) call `file.arrayBuffer()` as their
// first step, so without this polyfill any test driving a real file-select ->
// convert flow fails before the converter's own logic ever runs. Built on
// FileReader, which jsdom does implement.
function polyfillArrayBuffer(win) {
  if (typeof win.Blob.prototype.arrayBuffer === 'function') return;
  win.Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      var reader = new win.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// This jsdom version's Blob/File don't implement `.text()` either (same gap
// as `.arrayBuffer()` above) — txt-to-pdf.js, markdown-to-pdf.js, and
// markdown-to-docx.js all call `file.text()` as their first step. Built on
// the same FileReader jsdom does implement, mirroring polyfillArrayBuffer().
function polyfillBlobText(win) {
  if (typeof win.Blob.prototype.text === 'function') return;
  win.Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      var reader = new win.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

// Evaluate a production JS file *as-is* inside the window (no test hooks in the
// source). Bare `document`/`window`/`localStorage`/`fetch` resolve to this
// window, so the IIFE runs exactly as it would in the browser.
export function evalScript(dom, relPath) {
  const src = fs.readFileSync(path.join(ROOT, 'static', 'js', relPath), 'utf8');
  dom.window.eval(src);
}

// Let queued microtasks/promise chains (e.g. fetch().then().then()) settle.
export async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// Boot a script that self-inits on DOM-ready (e.g. nav.js). We wait for the
// window `load` (readyState 'complete') BEFORE eval so the script takes its
// synchronous `init()` branch exactly once — no race with JSDOM's own
// DOMContentLoaded, which would otherwise double-bind listeners.
export async function boot(dom, relPath) {
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve, { once: true });
  });
  evalScript(dom, relPath);
  await flush();
}

// Stand in for `new Image()` — jsdom never fires onload/onerror on its own
// (no real image decoder), so every canvas-based converter's `img.onload`
// callback would just hang forever without this. Setting `.src` schedules
// onload (with the given fake naturalWidth/naturalHeight) or onerror.
export function mockImageLoad(win, { width = 100, height = 80, shouldError = false } = {}) {
  win.Image = function () {
    var img = { onload: null, onerror: null, naturalWidth: 0, naturalHeight: 0 };
    var src = '';
    Object.defineProperty(img, 'src', {
      get: function () {
        return src;
      },
      set: function (v) {
        src = v;
        setTimeout(function () {
          if (shouldError) {
            if (img.onerror) img.onerror(new win.Event('error'));
          } else {
            img.naturalWidth = width;
            img.naturalHeight = height;
            if (img.onload) img.onload();
          }
        }, 0);
      }
    });
    return img;
  };
}

// Stand in for <canvas>.getContext('2d')/.toBlob — this jsdom build has no
// real canvas backend (getContext('2d') returns null), so every converter
// that draws to a canvas and calls toBlob needs this to resolve at all.
// Returns the list of {type, quality} toBlob was called with, the fake 2D
// context (so a test can assert fillRect/drawImage/putImageData calls), and
// canvasSizes — every converter sets canvas.width/height before calling
// getContext(), so capturing `this` there records the dimensions actually
// used even when the canvas itself is never inserted into the document
// (document.querySelector('canvas') would find nothing).
export function mockCanvas(win, { blobContent = 'fake-image-data' } = {}) {
  var toBlobCalls = [];
  var canvasSizes = [];
  var ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    // No-op transform stubs — needed by converters that rotate/flip/mask via
    // ctx.save()/translate()/rotate()/scale()/restore() (image-rotate-flip.js,
    // image-cropper.js). Existing converters never call these, so adding them
    // here doesn't change any other test's behavior.
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    createImageData: function (w, h) {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData: vi.fn(),
    // Fully opaque by default (alpha 255 on every pixel) — every real
    // getImageData() call returns that, and jpg-to-avif/png-to-avif read
    // this to build the raw RGBA buffer they hand to the AVIF worker.
    getImageData: function (x, y, w, h) {
      var data = new Uint8ClampedArray(w * h * 4);
      for (var i = 3; i < data.length; i += 4) data[i] = 255;
      return { data: data, width: w, height: h };
    }
  };
  win.HTMLCanvasElement.prototype.getContext = function () {
    canvasSizes.push({ width: this.width, height: this.height });
    return ctx;
  };
  win.HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    toBlobCalls.push({ type: type, quality: quality });
    setTimeout(function () {
      callback(new win.Blob([blobContent], { type: type || 'image/png' }));
    }, 0);
  };
  return { ctx: ctx, toBlobCalls: toBlobCalls, canvasSizes: canvasSizes };
}
