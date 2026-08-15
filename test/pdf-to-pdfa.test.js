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

describe('pdf-to-pdfa.js — window.convertFile', () => {
  it('rejects when the worker/lib config is missing', async () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/pdf-to-pdfa.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('sends the selected PDF/A part to the worker', async () => {
    const dom = createDom('<select id="opt-part"><option value="1B" selected>1B</option></select>');
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-to-pdfa.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);
    expect(sentMessages[0].part).toBe('1B');
  });

  it('defaults to 2B when the option is missing', async () => {
    const dom = createDom();
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-to-pdfa.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);
    expect(sentMessages[0].part).toBe('2B');
  });
});
