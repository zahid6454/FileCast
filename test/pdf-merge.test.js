import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

class FakeMergeWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: true, result: { bytes: new Uint8Array([9, 9, 9]) } } });
      }
    }, 0);
  }
  terminate() {}
}

class FakeFailingMergeWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: false, error: 'One of the files is not a valid PDF.' } });
      }
    }, 0);
  }
  terminate() {}
}

describe('pdf-merge.js — window.convertFiles', () => {
  it('rejects with fewer than 2 files, before touching the worker', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/pdf-merge.js');

    const file = new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    await expect(dom.window.convertFiles([file])).rejects.toThrow(/at least 2 pdf files/i);
  });

  it('rejects when the worker/lib config is missing', async () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/pdf-merge.js');

    const files = [
      new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }),
      new dom.window.File([new Uint8Array(10)], 'b.pdf', { type: 'application/pdf' })
    ];
    await expect(dom.window.convertFiles(files)).rejects.toThrow(/unavailable right now/i);
  });

  it('merges via the worker and resolves a named PDF blob', async () => {
    const dom = createDom();
    dom.window.Worker = FakeMergeWorker;
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-merge.js');

    const files = [
      new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }),
      new dom.window.File([new Uint8Array(10)], 'b.pdf', { type: 'application/pdf' })
    ];
    const { blob, filename } = await dom.window.convertFiles(files);

    expect(blob.type).toBe('application/pdf');
    expect(filename).toBe('merged.pdf');
  });

  it('rejects with the worker-reported error on merge failure', async () => {
    const dom = createDom();
    dom.window.Worker = FakeFailingMergeWorker;
    dom.window.TOOL_CONFIG = { pdf_lib_worker_src: '/x.js', pdf_lib_src: '/y.js' };
    evalScript(dom, 'converters/pdf-merge.js');

    const files = [
      new dom.window.File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }),
      new dom.window.File([new Uint8Array(10)], 'b.pdf', { type: 'application/pdf' })
    ];
    await expect(dom.window.convertFiles(files)).rejects.toThrow(/not a valid pdf/i);
  });
});
