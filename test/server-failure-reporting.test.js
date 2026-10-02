import { describe, expect, it, vi } from 'vitest';
import { boot, createDom, evalScript, flush } from './helpers.js';

// Server-side tool failures: the conversion worker already writes the admin
// "Recent errors" row (with the technical cause) when a job fails, so the
// browser must NOT also report it — a second row would be a duplicate with
// less detail. Failures the server never saw (rejected upload, network) are
// still reported by the browser. The user must see the server's message
// either way.

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
    <div id="progress" class="hidden"><div id="progress-fill"></div><span id="progress-label"></span></div>
    <div id="result" class="hidden"><div id="result-info"></div><div class="result__actions"></div><button id="download-btn"></button></div>
    <button id="reset-btn"></button>
    <button id="cancel-btn" class="hidden"></button>
    <div id="error-msg" class="hidden"></div>
    <div id="a11y-status"></div>
  `;
}

function installFakeXHR(win, respond) {
  function FakeXHR() {
    this.upload = { addEventListener() {} };
    this.status = 0;
    this.response = null;
  }
  FakeXHR.prototype.open = function (method, url) {
    this.url = url;
  };
  FakeXHR.prototype.setRequestHeader = function () {};
  FakeXHR.prototype.getResponseHeader = () => null;
  FakeXHR.prototype.abort = function () {};
  FakeXHR.prototype.send = function () {
    setTimeout(() => {
      const r = respond(this.url);
      this.status = r.status;
      this.response = r.body;
      if (this.onload) this.onload();
    }, 0);
  };
  win.XMLHttpRequest = FakeXHR;
}

async function run(respond) {
  const dom = createDom(toolPageHtml());
  dom.window.gtag = vi.fn();
  dom.window.fetch = vi.fn(() => Promise.resolve({ json: () => ({}) }));
  dom.window.FILECAST = { apiBase: 'https://api.filecast.test' };
  evalScript(dom, 'fc-util.js');
  dom.window.TOOL_CONFIG = {
    id: 'docx-to-pdf',
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
  installFakeXHR(dom.window, respond);
  await boot(dom, 'shared.js');
  evalScript(dom, 'server-upload.js');
  await flush();

  const input = dom.window.document.getElementById('file-input');
  const file = new dom.window.File([new Uint8Array(1024)], 'report.docx');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.getElementById('convert-btn').click();
  for (let i = 0; i < 8; i++) await flush();
  return dom;
}

const errorReports = (dom) =>
  dom.window.fetch.mock.calls
    .filter(([url]) => String(url).endsWith('/api/v1/errors'))
    .map(([, init]) => JSON.parse(init.body));

const health = { status: 200, body: { status: 'healthy' } };

describe('server-side tool failure reporting', () => {
  it('shows the server message and does not double-report a failed job', async () => {
    const dom = await run((url) => {
      if (/health$/.test(url)) return health;
      if (/convert\/docx-to-pdf$/.test(url)) return { status: 202, body: { job_id: 'j1' } };
      return {
        status: 200,
        body: {
          status: 'failed',
          error: 'Conversion failed. The file may be corrupted or password-protected.',
          error_type: 'conversion_error'
        }
      };
    });

    expect(dom.window.document.getElementById('error-msg').textContent).toContain(
      'may be corrupted or password-protected'
    );
    expect(errorReports(dom)).toHaveLength(0); // the worker logged it, with detail
  });

  it('still reports a failure the server never saw (upload rejected)', async () => {
    const dom = await run((url) => {
      if (/health$/.test(url)) return health;
      return { status: 400, body: { error: 'This file is not a valid DOCX.' } };
    });

    expect(errorReports(dom)).toHaveLength(1);
    expect(errorReports(dom)[0].error_message).toBe('This file is not a valid DOCX.');
  });
});
