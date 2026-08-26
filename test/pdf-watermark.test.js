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

function toolPage({ text, opacity, fontSize, angle = 45 }) {
  return createDom(`
    <input id="opt-text" type="text" value="${text}">
    <input id="opt-opacity" type="range" value="${opacity}">
    <input id="opt-fontSize" type="number" value="${fontSize}">
    <input id="opt-angle" type="range" min="0" max="359" value="${angle}">
  `);
}

describe('pdf-watermark.js — window.convertFile', () => {
  it('rejects when watermark text is blank', async () => {
    const dom = toolPage({ text: '  ', opacity: 30, fontSize: 40 });
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-watermark.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/enter watermark text/i);
  });

  it('rejects when the worker/lib config is missing', async () => {
    const dom = toolPage({ text: 'DRAFT', opacity: 30, fontSize: 40 });
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/pdf-watermark.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('converts opacity from a 0-100 percent input to a 0-1 fraction', async () => {
    const dom = toolPage({ text: 'DRAFT', opacity: 30, fontSize: 40 });
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-watermark.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);

    expect(sentMessages[0].text).toBe('DRAFT');
    expect(sentMessages[0].opacity).toBeCloseTo(0.3);
    expect(sentMessages[0].fontSize).toBe(40);
  });

  it('defaults to page-center position and 45deg angle when FCPageProof is absent', async () => {
    const dom = toolPage({ text: 'DRAFT', opacity: 30, fontSize: 40 });
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-watermark.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);

    expect(sentMessages[0].xPercent).toBe(50);
    expect(sentMessages[0].yPercent).toBe(50);
    expect(sentMessages[0].angle).toBe(45);
  });

  it('reflects a custom #opt-angle value', async () => {
    const dom = toolPage({ text: 'DRAFT', opacity: 30, fontSize: 40, angle: 120 });
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-watermark.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);

    expect(sentMessages[0].angle).toBe(120);
  });

  it('reads the drag position from window.FCPageProof.getWatermarkPosition() when present', async () => {
    const dom = toolPage({ text: 'DRAFT', opacity: 30, fontSize: 40 });
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    dom.window.FCPageProof = {
      init: () => {},
      getWatermarkPosition: () => ({ xPercent: 20, yPercent: 80 })
    };
    evalScript(dom, 'converters/pdf-watermark.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);

    expect(sentMessages[0].xPercent).toBe(20);
    expect(sentMessages[0].yPercent).toBe(80);
  });
});
