import { describe, expect, it, vi } from 'vitest';
import { boot, createDom, evalScript, flush } from './helpers.js';

// O4 audit item #11: the "Convert Another" button rendered by pdf-split.js's
// own showSplitResults() used to be a fresh element wired to location.reload()
// instead of the real #reset-btn shared.js already wired to resetUI() — so
// clicking it skipped the convert_another GA event (and did a full page
// reload instead of an in-page reset).

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
      <div class="result__actions">
        <button class="btn btn--success" id="download-btn">Download PDF</button>
        <button class="btn btn--primary" id="reset-btn">Convert Another</button>
      </div>
    </div>
    <button id="cancel-btn" class="hidden"></button>
    <div id="error-msg" class="hidden"></div>
    <div id="a11y-status"></div>
  `;
}

// Stands in for the real Worker (not implemented in jsdom) — replies with a
// fixed 2-page split, mirroring the payload shape pdf-lib-worker.js sends.
class FakeSplitWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({
          data: {
            ok: true,
            result: {
              parts: [
                { bytes: new Uint8Array([1, 2, 3]), pageNum: 1 },
                { bytes: new Uint8Array([4, 5, 6]), pageNum: 2 }
              ]
            }
          }
        });
      }
    }, 0);
  }
  terminate() {}
}

async function setupSplitToolPage() {
  const dom = createDom(toolPageHtml());
  dom.window.gtag = vi.fn();
  dom.window.Worker = FakeSplitWorker;
  evalScript(dom, 'fc-util.js');
  dom.window.TOOL_CONFIG = {
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
  };
  await boot(dom, 'shared.js');
  evalScript(dom, 'converters/pdf-split.js');
  return dom;
}

function selectFile(dom, file) {
  const input = dom.window.document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

describe('pdf-split.js — Convert Another button', () => {
  it('reuses the real #reset-btn instead of a location.reload() replacement', async () => {
    const dom = await setupSplitToolPage();
    const file = new dom.window.File([new Uint8Array(1024)], 'input.pdf', {
      type: 'application/pdf'
    });

    selectFile(dom, file);
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const resetBtn = dom.window.document.getElementById('reset-btn');
    expect(resetBtn).not.toBeNull();
    expect(resetBtn.closest('.result__actions')).not.toBeNull();

    resetBtn.click();
    await flush();

    // Only resetUI() (shared.js) fires this — the old fake button never did.
    const convertAnotherCall = dom.window.gtag.mock.calls.find((c) => c[1] === 'convert_another');
    expect(convertAnotherCall).toBeDefined();

    // And it did a real in-page reset, not a location.reload().
    expect(dom.window.document.getElementById('upload-zone').classList.contains('hidden')).toBe(
      false
    );
    expect(dom.window.document.getElementById('result').classList.contains('hidden')).toBe(true);
  });
});
