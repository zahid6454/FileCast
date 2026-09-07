import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush, mockCanvas } from './helpers.js';

class FakeHeicWorker {
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

class FakeErroringHeicWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: false, error: 'Could not decode this HEIC file.' } });
      }
    }, 0);
  }
  terminate() {}
}

describe('heic-to-webp.js — window.convertFile', () => {
  it('rejects immediately when the worker/lib config is missing', async () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = {}; // no heic_worker_src / libheif_src / libheif_wasm_src
    evalScript(dom, 'converters/heic-to-webp.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('decodes via the worker and resolves a WebP blob with no white-background compositing', async () => {
    const dom = createDom();
    dom.window.Worker = FakeHeicWorker;
    dom.window.TOOL_CONFIG = {
      heic_worker_src: '/x.js',
      libheif_src: '/y.js',
      libheif_wasm_src: '/y.wasm'
    };
    const { ctx, toBlobCalls } = mockCanvas(dom.window);
    evalScript(dom, 'converters/heic-to-webp.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/webp');
    expect(toBlobCalls).toEqual([{ type: 'image/webp', quality: 0.9 }]);
    expect(ctx.putImageData.mock.calls.length).toBe(1);
    expect(ctx.fillRect.mock.calls.length).toBe(0);
    expect(ctx.drawImage.mock.calls.length).toBe(0);
  });

  it('rejects with the worker-reported error when HEIC decoding fails', async () => {
    const dom = createDom();
    dom.window.Worker = FakeErroringHeicWorker;
    dom.window.TOOL_CONFIG = {
      heic_worker_src: '/x.js',
      libheif_src: '/y.js',
      libheif_wasm_src: '/y.wasm'
    };
    mockCanvas(dom.window);
    evalScript(dom, 'converters/heic-to-webp.js');

    const file = new dom.window.File([new Uint8Array(10)], 'bad.heic', { type: 'image/heic' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/could not decode this heic file/i);
  });

  it('cancelConversion terminates the active worker', async () => {
    const dom = createDom();
    let terminated = false;
    class TrackedWorker extends FakeHeicWorker {
      terminate() {
        terminated = true;
      }
    }
    dom.window.Worker = TrackedWorker;
    dom.window.TOOL_CONFIG = {
      heic_worker_src: '/x.js',
      libheif_src: '/y.js',
      libheif_wasm_src: '/y.wasm'
    };
    mockCanvas(dom.window);
    evalScript(dom, 'converters/heic-to-webp.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' });
    dom.window.convertFile(file);
    await flush();
    dom.window.cancelConversion();

    expect(terminated).toBe(true);
  });
});
