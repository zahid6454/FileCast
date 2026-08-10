import { describe, expect, it, vi } from 'vitest';
import { boot, createDom, evalScript, flush, mockCanvas } from './helpers.js';

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
        <button class="btn btn--success" id="download-btn">Download PNG</button>
        <button class="btn btn--primary" id="reset-btn">Convert Another</button>
      </div>
    </div>
    <button id="cancel-btn" class="hidden"></button>
    <div id="error-msg" class="hidden"></div>
    <div id="a11y-status"></div>
  `;
}

function mockPdfjsLib(win, { numPages = 1 } = {}) {
  win.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: function () {
      return {
        promise: Promise.resolve({
          numPages: numPages,
          getPage: function () {
            return Promise.resolve({
              getViewport: function () {
                return { width: 100, height: 100 };
              },
              render: function () {
                return { promise: Promise.resolve() };
              }
            });
          }
        })
      };
    }
  };
}

describe('pdf-to-png.js — window.convertFile', () => {
  it('renders a single-page PDF straight to a PNG blob, no multi-page UI takeover', async () => {
    const dom = createDom();
    mockPdfjsLib(dom.window, { numPages: 1 });
    const { toBlobCalls } = mockCanvas(dom.window);
    evalScript(dom, 'converters/pdf-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/png');
    expect(toBlobCalls).toEqual([{ type: 'image/png', quality: undefined }]);
    expect(dom.window._converterOwnsResult).toBeFalsy();
  });

  it('reuses the real #reset-btn for multi-page results instead of a location.reload() replacement', async () => {
    const dom = createDom(toolPageHtml());
    dom.window.gtag = vi.fn();
    evalScript(dom, 'fc-util.js');
    mockPdfjsLib(dom.window, { numPages: 2 });
    mockCanvas(dom.window);
    dom.window.TOOL_CONFIG = {
      id: 'pdf-to-png',
      input_format: 'PDF',
      output_format: 'PNG',
      type: 'client-side',
      ui_type: 'standard',
      accept_extensions: ['.pdf'],
      max_file_size_bytes: 25 * 1024 * 1024,
      max_file_size: '25MB'
    };
    await boot(dom, 'shared.js');
    evalScript(dom, 'converters/pdf-to-png.js');

    const input = dom.window.document.getElementById('file-input');
    const file = new dom.window.File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const resetBtn = dom.window.document.getElementById('reset-btn');
    expect(resetBtn).not.toBeNull();
    expect(resetBtn.closest('.result__actions')).not.toBeNull();

    resetBtn.click();
    await flush();

    const convertAnotherCall = dom.window.gtag.mock.calls.find((c) => c[1] === 'convert_another');
    expect(convertAnotherCall).toBeDefined();
  });
});
