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
        self.onmessage({ data: { ok: false, error: 'Incorrect password.' } });
      }
    }, 0);
  }
  terminate() {}
}

function toolPageWithPassword(value) {
  return createDom(`<input id="opt-password" type="password" autocomplete="off" value="${value}">`);
}

describe('pdf-unlock.js — window.convertFile', () => {
  it('rejects when the worker/lib config is missing', async () => {
    const dom = toolPageWithPassword('');
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/pdf-unlock.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('sends an empty password when none is entered (owner-only PDFs unlock automatically)', async () => {
    const dom = toolPageWithPassword('');
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-unlock.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('application/pdf');
    expect(sentMessages[0].op).toBe('unlock');
    expect(sentMessages[0].password).toBe('');
  });

  it('sends the entered password to the worker', async () => {
    const dom = toolPageWithPassword('secret123');
    const sentMessages = [];
    dom.window.Worker = makeFakeWorker(sentMessages);
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-unlock.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await dom.window.convertFile(file);
    expect(sentMessages[0].password).toBe('secret123');
  });

  it('rejects with the worker-reported error (e.g. incorrect password)', async () => {
    const dom = toolPageWithPassword('wrong');
    dom.window.Worker = FakeFailingWorker;
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-unlock.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/incorrect password/i);
  });
});
