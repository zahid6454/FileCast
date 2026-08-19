import { describe, expect, it } from 'vitest';
import { createDom, evalScript, mockCanvas } from './helpers.js';

class FakeTiffWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({
          data: { ok: true, rgba: new Uint8Array(4 * 2 * 2), width: 2, height: 2 }
        });
      }
    }, 0);
  }
  terminate() {}
}

class FakeErroringTiffWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: false, error: 'Not a valid TIFF file.' } });
      }
    }, 0);
  }
  terminate() {}
}

describe('tiff-to-png.js — window.convertFile', () => {
  it('rejects immediately when the worker/lib config is missing', async () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = {}; // no tiff_worker_src / utif_src
    evalScript(dom, 'converters/tiff-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'scan.tiff', { type: 'image/tiff' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('decodes via the worker and resolves a PNG blob, preserving alpha', async () => {
    const dom = createDom();
    dom.window.Worker = FakeTiffWorker;
    dom.window.TOOL_CONFIG = { tiff_worker_src: '/x.js', utif_src: '/y.js' };
    const { ctx, toBlobCalls } = mockCanvas(dom.window);
    evalScript(dom, 'converters/tiff-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'scan.tiff', { type: 'image/tiff' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/png');
    expect(toBlobCalls).toEqual([{ type: 'image/png', quality: undefined }]);
    expect(ctx.putImageData.mock.calls.length).toBe(1);
    // TIFF's alpha channel must survive into PNG, so no white-fill here.
    expect(ctx.fillRect.mock.calls.length).toBe(0);
  });

  it('rejects with the worker-reported error when TIFF decoding fails', async () => {
    const dom = createDom();
    dom.window.Worker = FakeErroringTiffWorker;
    dom.window.TOOL_CONFIG = { tiff_worker_src: '/x.js', utif_src: '/y.js' };
    mockCanvas(dom.window);
    evalScript(dom, 'converters/tiff-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'bad.tiff', { type: 'image/tiff' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/not a valid tiff file/i);
  });
});
