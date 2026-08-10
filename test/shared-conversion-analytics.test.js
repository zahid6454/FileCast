import { describe, expect, it, vi } from 'vitest';
import { boot, createDom, evalScript, flush } from './helpers.js';

// O4 audit item #10: a multi-output converter (pdf-split.js, pdf-to-jpg.js,
// pdf-to-png.js) sets window._converterOwnsResult and resolves convertFile
// with only its first page/image's blob — shared.js used to still report
// that blob's size as "the" output size and compute a bogus savings_percent
// against the whole original file (e.g. splitting a 5MB 10-page PDF could
// read as "80% smaller", which isn't a real compression ratio at all).

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

async function setupToolPage() {
  const dom = createDom(toolPageHtml());
  dom.window.gtag = vi.fn();
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
    output_extension: '.pdf'
  };
  await boot(dom, 'shared.js');
  return dom;
}

function selectFile(dom, file) {
  const input = dom.window.document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

function completedEventParams(dom) {
  const call = dom.window.gtag.mock.calls.find((c) => c[1] === 'conversion_completed');
  return call ? call[2] : undefined;
}

describe('shared.js — conversion_completed analytics', () => {
  it('omits output_size_bytes/savings_percent when the converter owns its own result UI', async () => {
    const dom = await setupToolPage();
    const original = new dom.window.File([new Uint8Array(2 * 1024 * 1024)], 'input.pdf', {
      type: 'application/pdf'
    });

    dom.window.convertFile = function () {
      dom.window._converterOwnsResult = true;
      var page1 = new dom.window.Blob([new Uint8Array(1024)], { type: 'application/pdf' });
      return Promise.resolve(page1);
    };

    selectFile(dom, original);
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const params = completedEventParams(dom);
    expect(params).toBeDefined();
    expect(params).not.toHaveProperty('output_size_bytes');
    expect(params).not.toHaveProperty('savings_percent');
  });

  it('still reports output_size_bytes/savings_percent for a normal single-output converter', async () => {
    const dom = await setupToolPage();
    const original = new dom.window.File([new Uint8Array(2 * 1024 * 1024)], 'input.pdf', {
      type: 'application/pdf'
    });

    dom.window.convertFile = function () {
      var output = new dom.window.Blob([new Uint8Array(1024 * 1024)], { type: 'application/pdf' });
      return Promise.resolve(output);
    };

    selectFile(dom, original);
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const params = completedEventParams(dom);
    expect(params).toBeDefined();
    expect(params.output_size_bytes).toBe(1024 * 1024);
    expect(params.savings_percent).toBe(50);
  });
});
