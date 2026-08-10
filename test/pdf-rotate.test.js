import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// Uint8Array bytes wrap modulo 256, so a fake result can't just stuff
// `degrees` (up to 270) into result.bytes — record what was actually sent
// instead, on the array a test passes in.
function makeFakeRotateWorker(sentMessages) {
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

class FakeFailingRotateWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: false, error: 'This PDF is encrypted.' } });
      }
    }, 0);
  }
  terminate() {}
}

function toolPageWithRotationSelect(value) {
  return createDom(
    `<select id="opt-rotation"><option value="${value}" selected>${value}</option></select>`
  );
}

describe('pdf-rotate.js — window.convertFile', () => {
  it('rejects when the worker/lib config is missing', async () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/pdf-rotate.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('sends the selected rotation degrees to the worker and resolves a PDF blob', async () => {
    const dom = toolPageWithRotationSelect('270');
    const sentMessages = [];
    dom.window.Worker = makeFakeRotateWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-rotate.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('application/pdf');
    expect(sentMessages[0].degrees).toBe(270);
  });

  it('defaults to 90 degrees when the select is missing', async () => {
    const dom = createDom();
    const sentMessages = [];
    dom.window.Worker = makeFakeRotateWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-rotate.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);
    expect(sentMessages[0].degrees).toBe(90);
  });

  it('rejects with the worker-reported error on rotate failure', async () => {
    const dom = createDom();
    dom.window.Worker = FakeFailingRotateWorker;
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-rotate.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/encrypted/i);
  });
});
