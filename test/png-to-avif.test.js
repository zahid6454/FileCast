import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush, mockCanvas, mockImageLoad } from './helpers.js';

class FakeAvifEncodeWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: true, avif: new Uint8Array([1, 2, 3]).buffer } });
      }
    }, 0);
  }
  terminate() {}
}

class FakeErroringAvifEncodeWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: false, error: 'Could not encode this image as AVIF.' } });
      }
    }, 0);
  }
  terminate() {}
}

function setUp(dom, WorkerClass) {
  dom.window.Worker = WorkerClass;
  dom.window.TOOL_CONFIG = {
    avif_worker_src: '/w.js',
    avif_lib_src: '/lib.js',
    avif_wasm_src: '/lib.wasm'
  };
  mockImageLoad(dom.window, { width: 50, height: 40 });
  mockCanvas(dom.window);
  evalScript(dom, 'converters/png-to-avif.js');
}

describe('png-to-avif.js — window.convertFile', () => {
  it('rejects immediately when the worker/lib config is missing', async () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/png-to-avif.js');

    const file = new dom.window.File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('encodes via the worker and resolves an AVIF blob, preserving transparency (channels:4)', async () => {
    const dom = createDom();
    let sentMessage = null;
    class CapturingWorker extends FakeAvifEncodeWorker {
      postMessage(msg) {
        sentMessage = msg;
        super.postMessage(msg);
      }
    }
    setUp(dom, CapturingWorker);

    const file = new dom.window.File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/avif');
    expect(sentMessage.type).toBe('encode');
    expect(sentMessage.channels).toBe(4);
    expect(sentMessage.width).toBe(50);
    expect(sentMessage.height).toBe(40);
    // default quality 65 -> quantizer round((100-65)*0.55) = 19
    expect(sentMessage.quantizer).toBe(19);
  });

  it('derives the quantizer from a custom quality slider value', async () => {
    const dom = createDom('<input id="opt-quality" value="30">');
    let sentMessage = null;
    class CapturingWorker extends FakeAvifEncodeWorker {
      postMessage(msg) {
        sentMessage = msg;
        super.postMessage(msg);
      }
    }
    setUp(dom, CapturingWorker);

    const file = new dom.window.File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    await dom.window.convertFile(file);

    // quality 30 -> quantizer round((100-30)*0.55) = 39
    expect(sentMessage.quantizer).toBe(39);
  });

  it('rejects with the worker-reported error when AVIF encoding fails', async () => {
    const dom = createDom();
    setUp(dom, FakeErroringAvifEncodeWorker);

    const file = new dom.window.File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(
      /could not encode this image as avif/i
    );
  });

  it('rejects when the image fails to load', async () => {
    const dom = createDom();
    dom.window.Worker = FakeAvifEncodeWorker;
    dom.window.TOOL_CONFIG = {
      avif_worker_src: '/w.js',
      avif_lib_src: '/lib.js',
      avif_wasm_src: '/lib.wasm'
    };
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/png-to-avif.js');

    const file = new dom.window.File([new Uint8Array(10)], 'bad.png', { type: 'image/png' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to load image/i);
  });

  it('cancelConversion terminates the active worker', async () => {
    const dom = createDom();
    let terminated = false;
    class TrackedWorker extends FakeAvifEncodeWorker {
      terminate() {
        terminated = true;
      }
    }
    setUp(dom, TrackedWorker);

    const file = new dom.window.File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    dom.window.convertFile(file);
    await flush();
    await flush();
    dom.window.cancelConversion();

    expect(terminated).toBe(true);
  });
});
