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

class FakeFailingWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({
          data: { ok: false, error: 'Removing those pages would leave an empty PDF.' }
        });
      }
    }, 0);
  }
  terminate() {}
}

describe('pdf-remove-pages.js — window.convertFile', () => {
  it('rejects when no page list is entered', async () => {
    const dom = createDom('<input id="opt-pages" type="text" value="">');
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-remove-pages.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/enter which pages/i);
  });

  it('sends the entered page list to the worker', async () => {
    const dom = createDom('<input id="opt-pages" type="text" value="2,4-6">');
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-remove-pages.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('application/pdf');
    expect(sentMessages[0].pages).toBe('2,4-6');
  });

  it('rejects with the worker-reported error when removing everything', async () => {
    const dom = createDom('<input id="opt-pages" type="text" value="1-5">');
    dom.window.Worker = FakeFailingWorker;
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-remove-pages.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/empty pdf/i);
  });
});
