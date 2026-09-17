import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

function makeFakeWorker(sentMessages) {
  return class {
    postMessage(msg) {
      sentMessages.push(msg);
      var self = this;
      setTimeout(function () {
        if (self.onmessage) {
          self.onmessage({ data: { ok: true, result: { bytes: new Uint8Array([1, 2, 3]) } } });
        }
      }, 0);
    }
    terminate() {}
  };
}

function toolPage({
  position,
  startNumber,
  format,
  fontFamily = 'Helvetica',
  fontSize = 10,
  customText = ''
}) {
  // .tool-options__row wraps the label+input like templates/tool.html
  // actually renders it — updateCustomTextVisibility() hides/shows that row
  // via closest('.tool-options__row'), so the fixture needs the real wrapper,
  // not a bare input, for that behavior to be exercised.
  function opt(value, current) {
    return `<option value="${value}"${value === current ? ' selected' : ''}>${value}</option>`;
  }
  return createDom(`
    <select id="opt-position"><option value="${position}" selected>${position}</option></select>
    <div class="tool-options__row">
      <input id="opt-startNumber" type="number" value="${startNumber}">
    </div>
    <select id="opt-format">
      ${opt('n', format)}
      ${opt('page-n', format)}
      ${opt('page-of-total', format)}
      ${opt('custom', format)}
    </select>
    <select id="opt-fontFamily"><option value="${fontFamily}" selected>${fontFamily}</option></select>
    <select id="opt-fontSize"><option value="${fontSize}" selected>${fontSize}</option></select>
    <div class="tool-options__row">
      <input id="opt-customText" type="text" value="${customText}">
    </div>
  `);
}

describe('pdf-page-numbers.js — window.convertFile', () => {
  it('rejects when the worker/lib config is missing', async () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/pdf-page-numbers.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('sends the selected position/start/format/font/size/customText to the worker', async () => {
    const dom = toolPage({
      position: 'top-right',
      startNumber: 5,
      format: 'custom',
      fontFamily: 'TimesRomanBold',
      fontSize: 14,
      customText: '10.1234/chap.01'
    });
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-page-numbers.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);

    expect(sentMessages[0].position).toBe('top-right');
    expect(sentMessages[0].startNumber).toBe(5);
    expect(sentMessages[0].format).toBe('custom');
    expect(sentMessages[0].fontFamily).toBe('TimesRomanBold');
    expect(sentMessages[0].fontSize).toBe(14);
    expect(sentMessages[0].customText).toBe('10.1234/chap.01');
  });

  it('defaults to bottom-center / 1 / plain number / Helvetica 10pt when options are missing', async () => {
    const dom = createDom();
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-page-numbers.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);

    expect(sentMessages[0].position).toBe('bottom-center');
    expect(sentMessages[0].startNumber).toBe(1);
    expect(sentMessages[0].format).toBe('n');
    expect(sentMessages[0].fontFamily).toBe('Helvetica');
    expect(sentMessages[0].fontSize).toBe(10);
    expect(sentMessages[0].customText).toBe('');
  });
});

describe('pdf-page-numbers.js — Custom Text field visibility', () => {
  it('hides the Custom text row and disables Start at when format is not "custom"', () => {
    const dom = toolPage({ position: 'bottom-center', startNumber: 1, format: 'n' });
    evalScript(dom, 'converters/pdf-page-numbers.js');

    const customTextRow = dom.window.document
      .getElementById('opt-customText')
      .closest('.tool-options__row');
    const startEl = dom.window.document.getElementById('opt-startNumber');
    expect(customTextRow.classList.contains('hidden')).toBe(true);
    expect(startEl.disabled).toBe(false);
  });

  it('shows the Custom text row and disables Start at once format becomes "custom"', () => {
    const dom = toolPage({ position: 'bottom-center', startNumber: 1, format: 'n' });
    evalScript(dom, 'converters/pdf-page-numbers.js');

    const formatEl = dom.window.document.getElementById('opt-format');
    formatEl.value = 'custom';
    formatEl.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const customTextRow = dom.window.document
      .getElementById('opt-customText')
      .closest('.tool-options__row');
    const startEl = dom.window.document.getElementById('opt-startNumber');
    expect(customTextRow.classList.contains('hidden')).toBe(false);
    expect(startEl.disabled).toBe(true);
  });
});
