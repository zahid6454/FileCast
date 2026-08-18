import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush, mockCanvas } from './helpers.js';

class FakeAvifWorker {
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

class FakeErroringAvifWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: false, error: 'Could not decode this AVIF file.' } });
      }
    }, 0);
  }
  terminate() {}
}

describe('avif-to-png.js — window.convertFile', () => {
  it('rejects immediately when the worker/lib config is missing', async () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/avif-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.avif', { type: 'image/avif' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('decodes via the worker and resolves a PNG blob with no white-background compositing', async () => {
    const dom = createDom();
    dom.window.Worker = FakeAvifWorker;
    dom.window.TOOL_CONFIG = {
      avif_worker_src: '/w.js',
      avif_dec_lib_src: '/lib.js',
      avif_dec_wasm_src: '/lib.wasm'
    };
    const { ctx, toBlobCalls } = mockCanvas(dom.window);
    evalScript(dom, 'converters/avif-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.avif', { type: 'image/avif' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/png');
    expect(toBlobCalls).toEqual([{ type: 'image/png', quality: undefined }]);
    // Straight putImageData, no white-background fill/composite (unlike JPG).
    expect(ctx.putImageData.mock.calls.length).toBe(1);
    expect(ctx.fillRect.mock.calls.length).toBe(0);
    expect(ctx.drawImage.mock.calls.length).toBe(0);
  });

  it('rejects with the worker-reported error when AVIF decoding fails', async () => {
    const dom = createDom();
    dom.window.Worker = FakeErroringAvifWorker;
    dom.window.TOOL_CONFIG = {
      avif_worker_src: '/w.js',
      avif_dec_lib_src: '/lib.js',
      avif_dec_wasm_src: '/lib.wasm'
    };
    mockCanvas(dom.window);
    evalScript(dom, 'converters/avif-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'bad.avif', { type: 'image/avif' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/could not decode this avif file/i);
  });

  it('cancelConversion terminates the active worker', async () => {
    const dom = createDom();
    let terminated = false;
    class TrackedWorker extends FakeAvifWorker {
      terminate() {
        terminated = true;
      }
    }
    dom.window.Worker = TrackedWorker;
    dom.window.TOOL_CONFIG = {
      avif_worker_src: '/w.js',
      avif_dec_lib_src: '/lib.js',
      avif_dec_wasm_src: '/lib.wasm'
    };
    mockCanvas(dom.window);
    evalScript(dom, 'converters/avif-to-png.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.avif', { type: 'image/avif' });
    dom.window.convertFile(file);
    await flush();
    dom.window.cancelConversion();

    expect(terminated).toBe(true);
  });
});
