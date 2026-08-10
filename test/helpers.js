import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

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
  return dom;
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
