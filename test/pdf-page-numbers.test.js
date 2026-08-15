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

function toolPage({ position, startNumber, format }) {
  return createDom(`
    <select id="opt-position"><option value="${position}" selected>${position}</option></select>
    <input id="opt-startNumber" type="number" value="${startNumber}">
    <select id="opt-format"><option value="${format}" selected>${format}</option></select>
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

  it('sends the selected position/start/format to the worker', async () => {
    const dom = toolPage({ position: 'top-right', startNumber: 5, format: 'page-n' });
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-page-numbers.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);

    expect(sentMessages[0].position).toBe('top-right');
    expect(sentMessages[0].startNumber).toBe(5);
    expect(sentMessages[0].format).toBe('page-n');
  });

  it('defaults to bottom-center / 1 / plain number when options are missing', async () => {
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
  });
});
