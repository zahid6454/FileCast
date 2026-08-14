import { describe, expect, it, vi } from 'vitest';
import { boot, createDom, evalScript, flush } from './helpers.js';

// O4 audit item #19: text-input converters ran window.convertText(text)
// synchronously on the main thread (unlike the PDF tools, moved off-thread
// in P4 §36) — a large CSV/JSON/XML input near max_file_size_bytes could
// visibly freeze the tab. shared-text.js now runs the converter inside
// text-converter-worker.js instead.

function toolPageHtml() {
  return `
    <textarea id="text-input"></textarea>
    <span id="char-count"></span>
    <span id="byte-count"></span>
    <button id="convert-btn"></button>
    <div id="progress" class="hidden"><div id="progress-fill"></div></div>
    <div id="text-result" class="hidden">
      <div id="result-info"></div>
      <textarea id="text-output"></textarea>
      <button id="copy-btn"></button>
      <button id="download-btn"></button>
    </div>
    <button id="reset-btn"></button>
    <div id="error-msg" class="hidden"></div>
    <button id="format-btn" class="hidden"></button>
    <div id="a11y-status"></div>
  `;
}

class FakeTextWorker {
  constructor(url) {
    this.url = url;
  }
  postMessage(msg) {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({
          data: { ok: true, result: { text: msg.text.toUpperCase(), filename: 'out.txt' } }
        });
      }
    }, 0);
  }
  terminate() {}
}

class IdentityTextWorker {
  postMessage(msg) {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: true, result: { text: msg.text, filename: 'output.txt' } } });
      }
    }, 0);
  }
  terminate() {}
}

class FakeFailingTextWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: false, error: 'Bad input.' } });
      }
    }, 0);
  }
  terminate() {}
}

async function setupTextToolPage(WorkerClass) {
  const dom = createDom(toolPageHtml());
  dom.window.gtag = vi.fn();
  dom.window.Worker = WorkerClass;
  evalScript(dom, 'fc-util.js');
  dom.window.TOOL_CONFIG = {
    id: 'json-to-yaml',
    ui_type: 'text-input',
    input_format: 'JSON',
    output_format: 'YAML',
    type: 'client-side',
    max_file_size_bytes: 25 * 1024 * 1024,
    max_file_size: '25MB',
    text_converter_src: '/js/converters/json-to-yaml.js',
    text_converter_worker_src: '/js/workers/text-converter-worker.js'
  };
  await boot(dom, 'shared-text.js');
  return dom;
}

describe('shared-text.js — worker-based conversion', () => {
  it('sends the converter URL as a query param and runs the conversion off-thread', async () => {
    const dom = await setupTextToolPage(FakeTextWorker);
    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));

    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const output = dom.window.document.getElementById('text-output');
    expect(output.value).toBe('HELLO');
    expect(dom.window.document.getElementById('text-result').classList.contains('hidden')).toBe(
      false
    );
  });

  it('constructs the worker URL with the converter passed as a query param', async () => {
    let capturedUrl = null;
    class CapturingWorker extends FakeTextWorker {
      constructor(url) {
        super(url);
        capturedUrl = url;
      }
    }
    const dom = await setupTextToolPage(CapturingWorker);
    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();

    expect(capturedUrl).toBe(
      '/js/workers/text-converter-worker.js?converter=%2Fjs%2Fconverters%2Fjson-to-yaml.js'
    );
  });

  it('shows an error and never reveals the result panel when the worker reports failure', async () => {
    const dom = await setupTextToolPage(FakeFailingTextWorker);
    const input = dom.window.document.getElementById('text-input');
    input.value = 'bad input';
    input.dispatchEvent(new dom.window.Event('input'));

    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    expect(dom.window.document.getElementById('error-msg').textContent).toBe('Bad input.');
    // Regression guard: setState('empty') used to run AFTER the error was
    // revealed and unconditionally re-hid #error-msg, so the message never
    // stayed visible long enough for a user (or Playwright) to see it.
    expect(dom.window.document.getElementById('error-msg').classList.contains('hidden')).toBe(
      false
    );
    expect(dom.window.document.getElementById('text-result').classList.contains('hidden')).toBe(
      true
    );
  });

  it('shows a friendly error instead of throwing when worker config is missing', async () => {
    const dom = await setupTextToolPage(FakeTextWorker);
    dom.window.TOOL_CONFIG.text_converter_src = null;
    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));

    dom.window.document.getElementById('convert-btn').click();
    await flush();

    expect(dom.window.document.getElementById('error-msg').textContent).toContain('unavailable');
  });

  // Regression: downloadOutput() used to detect a data: URL output by
  // sniffing whether window._convertedText happened to start with "data:",
  // instead of checking the tool's own output_is_data_url config — so any
  // ordinary text tool whose legitimate output text started with the
  // literal string "data:" (e.g. Base64 Encode/Decode round-tripping a data
  // URI as plain text) would silently download the wrong, re-decoded bytes
  // instead of the text actually shown on screen.
  it('downloads the literal output text for a tool that is not output_is_data_url, even if the text starts with "data:"', async () => {
    const dom = await setupTextToolPage(IdentityTextWorker);
    dom.window.TOOL_CONFIG.output_is_data_url = false;
    const literalOutput = 'data:text/plain;base64,SGVsbG8=';

    const input = dom.window.document.getElementById('text-input');
    input.value = literalOutput;
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    let capturedBlob = null;
    dom.window.URL.createObjectURL = (blob) => {
      capturedBlob = blob;
      return 'blob:mock/test';
    };
    dom.window.document.getElementById('download-btn').click();

    expect(capturedBlob).not.toBeNull();
    const text = new dom.window.TextDecoder('utf-8').decode(await capturedBlob.arrayBuffer());
    expect(text).toBe(literalOutput);
  });

  it('decodes to real binary bytes on download for a tool that IS output_is_data_url', async () => {
    const dom = await setupTextToolPage(IdentityTextWorker);
    dom.window.TOOL_CONFIG.output_is_data_url = true;
    const dataUrl = 'data:text/plain;base64,SGVsbG8=';

    const input = dom.window.document.getElementById('text-input');
    input.value = dataUrl;
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    let capturedBlob = null;
    dom.window.URL.createObjectURL = (blob) => {
      capturedBlob = blob;
      return 'blob:mock/test';
    };
    dom.window.document.getElementById('download-btn').click();

    expect(capturedBlob.type).toBe('text/plain');
    const text = new dom.window.TextDecoder('utf-8').decode(await capturedBlob.arrayBuffer());
    expect(text).toBe('Hello');
  });
});
