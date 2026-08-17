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

function toolPage(pageSize) {
  return createDom(`
    <select id="opt-pageSize"><option value="${pageSize}" selected>${pageSize}</option></select>
  `);
}

describe('markdown-to-pdf.js — window.convertFile', () => {
  it('rejects when the worker/lib config is missing', async () => {
    const dom = toolPage('letter');
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/markdown-to-pdf.js');

    const file = new dom.window.File(['# Title'], 'a.md', { type: 'text/markdown' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('sends the file text and chosen page size to the worker', async () => {
    const dom = toolPage('a4');
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/markdown-to-pdf.js');

    const file = new dom.window.File(['# Title\n\nSome **bold** text.'], 'a.md', {
      type: 'text/markdown'
    });
    const blob = await dom.window.convertFile(file);

    expect(sentMessages[0].op).toBe('markdownToPdf');
    expect(sentMessages[0].text).toBe('# Title\n\nSome **bold** text.');
    expect(sentMessages[0].pageSize).toBe('a4');
    expect(blob.type).toBe('application/pdf');
  });

  it('defaults to Letter when no page size control is present', async () => {
    const dom = createDom('');
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/markdown-to-pdf.js');

    const file = new dom.window.File(['hello'], 'a.md', { type: 'text/markdown' });
    await dom.window.convertFile(file);

    expect(sentMessages[0].pageSize).toBe('letter');
  });

  it('rejects with the worker error message on failure', async () => {
    const dom = toolPage('letter');
    dom.window.Worker = class {
      postMessage() {
        var self = this;
        setTimeout(function () {
          if (self.onmessage) {
            self.onmessage({ data: { ok: false, error: 'This file has no content to convert.' } });
          }
        }, 0);
      }
      terminate() {}
    };
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/markdown-to-pdf.js');

    const file = new dom.window.File([''], 'empty.md', { type: 'text/markdown' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/no content to convert/i);
  });
});
