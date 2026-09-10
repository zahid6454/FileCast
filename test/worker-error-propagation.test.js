import { describe, expect, it, vi } from 'vitest';
import { boot, createDom, evalScript, flush } from './helpers.js';

// Review finding: the classification primitives (FC.classifyError/
// FC.errorFromType) were unit-tested in isolation, but nothing exercised the
// actual regression path — a worker-based converter (pdf-split.js, and ~24
// others) posting {ok:false, error, errorType} across postMessage, getting
// reconstructed into an Error by the converter, caught by shared.js, and
// landing in the payload POSTed to /api/v1/errors. This is the path that was
// silently broken (everything from these tools read as validation_error,
// including genuine crashes) before FC.errorFromType existed.

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

class FakeWorker {
  constructor(response) {
    this._response = response;
  }
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) self.onmessage({ data: self._response });
    }, 0);
  }
  terminate() {}
}

async function setupSplitToolPage(workerResponse, configOverrides) {
  const dom = createDom(toolPageHtml());
  dom.window.gtag = vi.fn();
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  const postedErrors = [];
  dom.window.fetch = vi.fn((url, opts) => {
    if (String(url).includes('/api/v1/errors')) {
      postedErrors.push(JSON.parse(opts.body));
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  dom.window.Worker = function () {
    return new FakeWorker(workerResponse);
  };
  evalScript(dom, 'fc-util.js');
  dom.window.TOOL_CONFIG = Object.assign(
    {
      id: 'pdf-split',
      input_format: 'PDF',
      output_format: 'PDF',
      type: 'client-side',
      ui_type: 'standard',
      accept_extensions: ['.pdf'],
      max_file_size_bytes: 25 * 1024 * 1024,
      max_file_size: '25MB',
      pdf_lib_worker_src: '/static/js/workers/pdf-lib-worker.js',
      pdf_lib_src: '/static/lib/pdf-lib.min.js'
    },
    configOverrides
  );
  await boot(dom, 'shared.js');
  evalScript(dom, 'converters/pdf-split.js');
  return { dom, postedErrors };
}

function selectAndConvert(dom) {
  const file = new dom.window.File([new Uint8Array(1024)], 'input.pdf', {
    type: 'application/pdf'
  });
  const input = dom.window.document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.getElementById('convert-btn').click();
}

describe('worker-based converter (pdf-split.js) — error_type reaches the admin report', () => {
  it('reports validation_error, with the real message, for a data.ok:false/validation_error worker reply', async () => {
    const { dom, postedErrors } = await setupSplitToolPage({
      ok: false,
      error: 'This PDF has only one page. There is nothing to split.',
      errorType: 'validation_error'
    });
    selectAndConvert(dom);
    await flush();
    await flush();

    expect(postedErrors).toHaveLength(1);
    expect(postedErrors[0].error_type).toBe('validation_error');
    expect(postedErrors[0].error_message).toBe(
      'This PDF has only one page. There is nothing to split.'
    );
    expect(dom.window.document.getElementById('error-msg').textContent).toBe(
      'This PDF has only one page. There is nothing to split.'
    );
  });

  it("reports conversion_error, not validation_error, for a data.ok:false/conversion_error worker reply (e.g. pdf-lib-worker.js's own internal-bug case)", async () => {
    const { dom, postedErrors } = await setupSplitToolPage({
      ok: false,
      error: 'Unknown worker operation: split',
      errorType: 'conversion_error'
    });
    selectAndConvert(dom);
    await flush();
    await flush();

    expect(postedErrors).toHaveLength(1);
    expect(postedErrors[0].error_type).toBe('conversion_error');
    expect(postedErrors[0].error_message).toBe('Unknown worker operation: split');
  });

  it('reports conversion_error for the tool\'s own "config not wired up" pre-flight guard, not validation_error', async () => {
    const { dom, postedErrors } = await setupSplitToolPage(
      { ok: true },
      { pdf_lib_worker_src: null }
    );
    selectAndConvert(dom);
    await flush();
    await flush();

    expect(postedErrors).toHaveLength(1);
    expect(postedErrors[0].error_type).toBe('conversion_error');
    expect(postedErrors[0].error_message).toBe(
      'Split is unavailable right now. Please refresh the page.'
    );
  });
});
