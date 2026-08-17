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

function toolPage({ pageSize, fontSize }) {
  return createDom(`
    <select id="opt-pageSize"><option value="${pageSize}" selected>${pageSize}</option></select>
    <input id="opt-fontSize" type="number" value="${fontSize}">
  `);
}

describe('txt-to-pdf.js — window.convertFile', () => {
  it('rejects when the worker/lib config is missing', async () => {
    const dom = toolPage({ pageSize: 'letter', fontSize: 11 });
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/txt-to-pdf.js');

    const file = new dom.window.File(['hello world'], 'a.txt', { type: 'text/plain' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('sends the chosen page size and font size to the worker', async () => {
    const dom = toolPage({ pageSize: 'a4', fontSize: 14 });
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/txt-to-pdf.js');

    const file = new dom.window.File(['hello world'], 'a.txt', { type: 'text/plain' });
    const blob = await dom.window.convertFile(file);

    expect(sentMessages[0].op).toBe('txtToPdf');
    expect(sentMessages[0].text).toBe('hello world');
    expect(sentMessages[0].pageSize).toBe('a4');
    expect(sentMessages[0].fontSize).toBe(14);
    expect(blob.type).toBe('application/pdf');
  });

  it('falls back to a default font size when the field is blank or invalid', async () => {
    const dom = createDom(`
      <select id="opt-pageSize"><option value="letter" selected>Letter</option></select>
      <input id="opt-fontSize" type="number" value="">
    `);
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/txt-to-pdf.js');

    const file = new dom.window.File(['hello world'], 'a.txt', { type: 'text/plain' });
    await dom.window.convertFile(file);

    expect(sentMessages[0].fontSize).toBe(11);
  });

  it('rejects with the worker error message on failure', async () => {
    const dom = createDom(`
      <select id="opt-pageSize"><option value="letter" selected>Letter</option></select>
      <input id="opt-fontSize" type="number" value="11">
    `);
    dom.window.Worker = class {
      postMessage() {
        var self = this;
        setTimeout(function () {
          if (self.onmessage) {
            self.onmessage({ data: { ok: false, error: 'This file has no text to convert.' } });
          }
        }, 0);
      }
      terminate() {}
    };
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/txt-to-pdf.js');

    const file = new dom.window.File([''], 'empty.txt', { type: 'text/plain' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/no text to convert/i);
  });
});
