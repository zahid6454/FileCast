import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush, mockCanvas, mockImageLoad } from './helpers.js';

class FakeAvifEncodeWorker {
  constructor() {
    this.messages = [];
  }
  postMessage(msg) {
    this.messages.push(msg);
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
    avif_enc_lib_src: '/enc.js',
    avif_enc_wasm_src: '/enc.wasm'
  };
  mockImageLoad(dom.window, { width: 100, height: 80 });
  mockCanvas(dom.window);
  evalScript(dom, 'converters/jpg-to-avif.js');
}

describe('jpg-to-avif.js — window.convertFile', () => {
  it('rejects immediately when the worker/lib config is missing', async () => {
    const dom = createDom();
    dom.window.TOOL_CONFIG = {};
    evalScript(dom, 'converters/jpg-to-avif.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unavailable right now/i);
  });

  it('encodes via the worker with the default quality and resolves an AVIF blob', async () => {
    const dom = createDom();
    setUp(dom, FakeAvifEncodeWorker);

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/avif');
  });

  it("sends the image's dimensions and the quality slider value straight through", async () => {
    const dom = createDom('<input id="opt-quality" value="80">');
    let sentMessage = null;
    class CapturingWorker extends FakeAvifEncodeWorker {
      postMessage(msg) {
        sentMessage = msg;
        super.postMessage(msg);
      }
    }
    setUp(dom, CapturingWorker);

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    expect(sentMessage.type).toBe('encode');
    expect(sentMessage.width).toBe(100);
    expect(sentMessage.height).toBe(80);
    expect(sentMessage.quality).toBe(80);
  });

  it('falls back to the 65% default quality when no slider is present', async () => {
    const dom = createDom();
    let sentMessage = null;
    class CapturingWorker extends FakeAvifEncodeWorker {
      postMessage(msg) {
        sentMessage = msg;
        super.postMessage(msg);
      }
    }
    setUp(dom, CapturingWorker);

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    expect(sentMessage.quality).toBe(65);
  });

  it('rejects with the worker-reported error when AVIF encoding fails', async () => {
    const dom = createDom();
    setUp(dom, FakeErroringAvifEncodeWorker);

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(
      /could not encode this image as avif/i
    );
  });

  it('rejects when the image fails to load', async () => {
    const dom = createDom();
    dom.window.Worker = FakeAvifEncodeWorker;
    dom.window.TOOL_CONFIG = {
      avif_worker_src: '/w.js',
      avif_enc_lib_src: '/enc.js',
      avif_enc_wasm_src: '/enc.wasm'
    };
    mockImageLoad(dom.window, { shouldError: true });
    mockCanvas(dom.window);
    evalScript(dom, 'converters/jpg-to-avif.js');

    const file = new dom.window.File([new Uint8Array(10)], 'bad.jpg', { type: 'image/jpeg' });
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

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    dom.window.convertFile(file);
    await flush();
    await flush(); // image load + canvas read both need a tick
    dom.window.cancelConversion();

    expect(terminated).toBe(true);
  });
});
