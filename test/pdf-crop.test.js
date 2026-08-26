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

describe('pdf-crop.js — window.convertFile', () => {
  it('rejects when the worker/lib config is missing', () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/pdf-crop.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    return expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('sends the crop box from FCPageProof.getCropRect() to the worker', async () => {
    const dom = createDom();
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    dom.window.FCPageProof = {
      init: () => {},
      getCropRect: () => ({ xPercent: 15, yPercent: 20, widthPercent: 60, heightPercent: 50 })
    };
    evalScript(dom, 'converters/pdf-crop.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);

    expect(sentMessages[0]).toMatchObject({
      op: 'crop',
      xPercent: 15,
      yPercent: 20,
      widthPercent: 60,
      heightPercent: 50
    });
  });

  it('defaults to a centered 80% box when FCPageProof is absent', async () => {
    const dom = createDom();
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-crop.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);

    expect(sentMessages[0]).toMatchObject({
      op: 'crop',
      xPercent: 10,
      yPercent: 10,
      widthPercent: 80,
      heightPercent: 80
    });
  });
});
