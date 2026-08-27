import { describe, expect, it, vi } from 'vitest';
import { boot, createDom, evalScript, flush } from './helpers.js';

// Phase 3 stress test, Finding 5: the Cancel button never appeared on a
// visitor's first-ever conversion on a fresh page load. shared.js's own
// visibility check ran synchronously, before server-upload.js's
// window.convertFile() had a chance to run (it's called one microtask later,
// via Promise.resolve().then(...)) — and window.cancelConversion is only
// ever assigned INSIDE convertFile(). Fixed by having server-upload.js show
// the button itself, right where it owns cancelConversion's lifecycle.

function toolPageHtml() {
  return `
    <div id="upload-zone"></div>
    <input id="file-input" type="file" />
    <div id="file-info" class="hidden">
      <img id="file-preview" class="hidden" />
      <span id="file-name"></span>
      <span id="file-size"></span>
    </div>
    <button id="convert-btn"></button>
    <div id="progress" class="hidden">
      <div id="progress-fill"></div>
      <span id="progress-label"></span>
    </div>
    <div id="result" class="hidden">
      <div id="result-info"></div>
      <div class="result__actions"></div>
      <button id="download-btn"></button>
    </div>
    <button id="reset-btn"></button>
    <button id="cancel-btn" class="hidden"></button>
    <div id="error-msg" class="hidden"></div>
    <div id="a11y-status"></div>
  `;
}

// A minimal XMLHttpRequest stand-in — server-upload.js's checkHealth() and
// window.convertFile() both drive real XHRs (upload progress, polling,
// download), none of which should touch the network in a unit test. Requests
// are dispatched to `onRequest(xhr, body)`, which decides how/when (or
// whether) to resolve each one by URL.
function installFakeXHR(win, onRequest) {
  function FakeXHR() {
    this.upload = { addEventListener: function () {} };
    this.status = 0;
    this.response = null;
  }
  FakeXHR.prototype.open = function (method, url) {
    this.method = method;
    this.url = url;
  };
  FakeXHR.prototype.setRequestHeader = function () {};
  FakeXHR.prototype.getResponseHeader = function () {
    return null;
  };
  FakeXHR.prototype.send = function (body) {
    onRequest(this, body);
  };
  FakeXHR.prototype.abort = function () {
    if (this.onabort) this.onabort();
  };
  win.XMLHttpRequest = FakeXHR;
}

async function setupServerToolPage() {
  const dom = createDom(toolPageHtml());
  dom.window.gtag = vi.fn();
  evalScript(dom, 'fc-util.js');
  dom.window.TOOL_CONFIG = {
    id: 'docx-to-pdf',
    name: 'DOCX to PDF',
    type: 'server-side',
    ui_type: 'standard',
    input_format: 'DOCX',
    output_format: 'PDF',
    accept_extensions: ['.docx'],
    max_file_size_bytes: 25 * 1024 * 1024,
    max_file_size: '25MB',
    output_extension: '.pdf',
    api_base_url: 'https://api.filecast.test',
    api_endpoint: 'https://api.filecast.test/api/v1/convert/docx-to-pdf'
  };

  // checkHealth() answers 'healthy' immediately; the convert POST resolves to
  // a job_id but the poll it kicks off is left pending (never resolved) —
  // simulating a real slow/in-flight conversion, exactly the "first
  // conversion, still converting" moment Finding 5 is about.
  installFakeXHR(dom.window, (xhr, _body) => {
    setTimeout(() => {
      if (/\/api\/v1\/health$/.test(xhr.url)) {
        xhr.status = 200;
        xhr.responseText = JSON.stringify({ status: 'healthy' });
        xhr.response = { status: 'healthy' };
        if (xhr.onload) xhr.onload();
      } else if (/\/convert\/docx-to-pdf$/.test(xhr.url)) {
        xhr.status = 202;
        xhr.response = { job_id: 'job-1' };
        if (xhr.onload) xhr.onload();
      }
      // Any /jobs/job-1 poll is left hanging on purpose — nothing resolves
      // it, so the conversion stays 'converting' for the life of the test.
    }, 0);
  });

  await boot(dom, 'shared.js');
  evalScript(dom, 'server-upload.js');
  await flush();
  return dom;
}

function selectFile(dom, file) {
  const input = dom.window.document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

describe('Cancel button visibility on a fresh page load (Finding 5)', () => {
  it('shows #cancel-btn during a visitor’s first-ever conversion', async () => {
    const dom = await setupServerToolPage();
    const cancelBtn = dom.window.document.getElementById('cancel-btn');
    expect(cancelBtn.classList.contains('hidden')).toBe(true);

    // Sanity check for the bug this guards against: window.cancelConversion
    // must not already exist before this run (a second-conversion repro
    // would mask the bug — see the report's own note on this).
    expect(typeof dom.window.cancelConversion).toBe('undefined');

    const file = new dom.window.File([new Uint8Array(1024)], 'report.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    selectFile(dom, file);
    dom.window.document.getElementById('convert-btn').click();

    await flush();

    expect(typeof dom.window.cancelConversion).toBe('function');
    expect(cancelBtn.classList.contains('hidden')).toBe(false);
  });
});
