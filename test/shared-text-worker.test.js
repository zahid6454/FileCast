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
      <div id="text-output-table" class="hidden"></div>
      <div id="text-output-editor">
        <textarea id="text-output"></textarea>
      </div>
      <img id="text-image-preview" class="hidden" alt="Converted image preview">
      <button id="copy-btn">Copy to Clipboard</button>
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

// Mirrors hash-generator.js's flat `table` shape: [{label, value}, ...].
class FlatTableTextWorker {
  postMessage(msg) {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({
          data: {
            ok: true,
            result: {
              text: 'MD5:     abc\nSHA-256: def\n',
              filename: 'hashes.txt',
              table: [
                { label: 'MD5', value: 'abc' },
                { label: 'SHA-256', value: 'def' }
              ]
            }
          }
        });
      }
    }, 0);
  }
  terminate() {}
}

// Mirrors number-base-converter.js's grouped `table` shape:
// [{input, fields: [{label, value}, ...]}, ...].
class GroupedTableTextWorker {
  postMessage(msg) {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({
          data: {
            ok: true,
            result: {
              text: 'Input: 123\n  Binary:  1111011',
              filename: 'number-bases.txt',
              table: [
                {
                  input: '123',
                  fields: [
                    { label: 'Binary', value: '1111011' },
                    { label: 'Decimal', value: '123' }
                  ]
                }
              ]
            }
          }
        });
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

  // output_is_data_url also covers non-image binary output (CSV to Excel's
  // .xlsx bytes, base64-encoded) — the <img> preview must not try to render
  // that as a picture just because the tool is output_is_data_url.
  it('does not show the image preview for a non-image output_is_data_url result', async () => {
    const dom = await setupTextToolPage(IdentityTextWorker);
    dom.window.TOOL_CONFIG.output_is_data_url = true;
    const xlsxDataUrl =
      'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsD';

    const input = dom.window.document.getElementById('text-input');
    input.value = xlsxDataUrl;
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const preview = dom.window.document.getElementById('text-image-preview');
    expect(preview.classList.contains('hidden')).toBe(true);
    expect(preview.getAttribute('src')).toBeNull();
  });

  it('shows the image preview for an image output_is_data_url result', async () => {
    const dom = await setupTextToolPage(IdentityTextWorker);
    dom.window.TOOL_CONFIG.output_is_data_url = true;
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    const input = dom.window.document.getElementById('text-input');
    input.value = imageDataUrl;
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const preview = dom.window.document.getElementById('text-image-preview');
    expect(preview.classList.contains('hidden')).toBe(false);
    expect(preview.getAttribute('src')).toBe(imageDataUrl);
  });
});

// Tool UI audit §3/§4: a converter may return a structured `table` field
// alongside `text` (hash-generator.js's flat rows, number-base-converter.js's
// grouped rows) — shared-text.js's renderOutputTable() swaps the textarea
// for a rendered <table> when present, mirroring shared-diff.js's existing
// renderDiffReport()/`diffs` pattern.
describe('shared-text.js — structured table output (tool UI audit §3/§4)', () => {
  it('renders a flat table and hides the textarea editor when `table` is a flat list', async () => {
    const dom = await setupTextToolPage(FlatTableTextWorker);
    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const tableWrap = dom.window.document.getElementById('text-output-table');
    const editor = dom.window.document.getElementById('text-output-editor');
    expect(tableWrap.classList.contains('hidden')).toBe(false);
    expect(editor.classList.contains('hidden')).toBe(true);

    const table = tableWrap.querySelector('table.out-table');
    expect(table).not.toBeNull();
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('MD5');
    expect(rows[0].textContent).toContain('abc');
    expect(rows[1].textContent).toContain('SHA-256');
    expect(rows[1].textContent).toContain('def');

    // The textarea stays populated underneath — Copy/Download read from
    // window._convertedText, not from whichever view is visible.
    expect(dom.window.document.getElementById('text-output').value).toBe(
      'MD5:     abc\nSHA-256: def\n'
    );
    expect(dom.window._convertedText).toBe('MD5:     abc\nSHA-256: def\n');
  });

  it('renders a grouped table with a title bar per input when `table` entries carry `fields`', async () => {
    const dom = await setupTextToolPage(GroupedTableTextWorker);
    const input = dom.window.document.getElementById('text-input');
    input.value = '123';
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const tableWrap = dom.window.document.getElementById('text-output-table');
    expect(tableWrap.classList.contains('hidden')).toBe(false);
    expect(
      dom.window.document.getElementById('text-output-editor').classList.contains('hidden')
    ).toBe(true);

    const table = tableWrap.querySelector('table.kv-table');
    expect(table).not.toBeNull();
    const group = table.querySelector('tbody.group');
    expect(group).not.toBeNull();
    expect(group.querySelector('.group-title th').textContent).toContain('123');
    const valueRows = group.querySelectorAll('tr:not(.group-title)');
    expect(valueRows).toHaveLength(2);
    expect(valueRows[0].textContent).toContain('Binary');
    expect(valueRows[0].textContent).toContain('1111011');
  });

  it('keeps the plain textarea visible and the table hidden when the converter returns no `table`', async () => {
    const dom = await setupTextToolPage(FakeTextWorker);
    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    expect(
      dom.window.document.getElementById('text-output-table').classList.contains('hidden')
    ).toBe(true);
    expect(
      dom.window.document.getElementById('text-output-editor').classList.contains('hidden')
    ).toBe(false);
    expect(dom.window.document.getElementById('text-output').value).toBe('HELLO');
  });

  it('falls back to the plain textarea instead of building an oversized table for a pathological entry count', async () => {
    class HugeTableTextWorker {
      postMessage() {
        var self = this;
        setTimeout(function () {
          if (self.onmessage) {
            var table = [];
            for (var i = 0; i < 501; i++) {
              table.push({ label: 'Row ' + i, value: String(i) });
            }
            self.onmessage({
              data: { ok: true, result: { text: 'big output', filename: 'out.txt', table: table } }
            });
          }
        }, 0);
      }
      terminate() {}
    }

    const dom = await setupTextToolPage(HugeTableTextWorker);
    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    expect(
      dom.window.document.getElementById('text-output-table').classList.contains('hidden')
    ).toBe(true);
    expect(
      dom.window.document.getElementById('text-output-editor').classList.contains('hidden')
    ).toBe(false);
    // The full result is still there for Copy/Download either way.
    expect(dom.window.document.getElementById('text-output').value).toBe('big output');
  });

  it('rebuilds the table from scratch on a second conversion instead of appending duplicate rows', async () => {
    const dom = await setupTextToolPage(FlatTableTextWorker);
    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));

    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const table = dom.window.document.querySelector('#text-output-table table.out-table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
  });
});

// Tool UI audit §7: navigator.clipboard.writeText() had no .catch(), so a
// rejected promise left the Copy button unchanged with no indication
// anything failed. If navigator.clipboard doesn't exist at all (jsdom's
// default — matching an old browser or a non-HTTPS context), .writeText
// throws a SYNCHRONOUS TypeError on property access, before any promise
// exists to catch, so a feature-detect guard has to run first.
describe('shared-text.js — Copy to Clipboard fallback (tool UI audit §7)', () => {
  async function convertAndGetCopyBtn(dom) {
    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();
    return dom.window.document.getElementById('copy-btn');
  }

  it('shows a visible fallback instead of silently doing nothing when navigator.clipboard does not exist', async () => {
    const dom = await setupTextToolPage(IdentityTextWorker);
    // jsdom has no Clipboard API implementation by default — this is the
    // real-world "old browser / non-HTTPS" condition, not a manual override.
    expect(dom.window.navigator.clipboard).toBeUndefined();

    const copyBtn = await convertAndGetCopyBtn(dom);
    const original = copyBtn.textContent;
    copyBtn.click();

    expect(copyBtn.textContent).toBe('Clipboard not available — select manually.');
    expect(copyBtn.textContent).not.toBe(original);
  });

  it('shows "Copied!" on a successful write', async () => {
    const dom = await setupTextToolPage(IdentityTextWorker);
    dom.window.navigator.clipboard = { writeText: () => Promise.resolve() };

    const copyBtn = await convertAndGetCopyBtn(dom);
    copyBtn.click();
    await flush();

    expect(copyBtn.textContent).toBe('Copied!');
  });

  it('shows a visible fallback when navigator.clipboard.writeText() rejects', async () => {
    const dom = await setupTextToolPage(IdentityTextWorker);
    dom.window.navigator.clipboard = {
      writeText: () => Promise.reject(new Error('permission denied'))
    };

    const copyBtn = await convertAndGetCopyBtn(dom);
    copyBtn.click();
    await flush();

    expect(copyBtn.textContent).toBe("Couldn't copy — select manually.");
  });
});

// Tool UI audit round 2, §3: the flat output table's per-row copy icon
// (hash-generator.js's Algorithm/Hash rows) rendered with no click handler
// at all — clicking it did nothing, silently.
describe('shared-text.js — per-row copy icon (tool UI audit round 2, §3)', () => {
  it("copies the clicked row's own value, not the whole result, and shows a checkmark", async () => {
    const dom = await setupTextToolPage(FlatTableTextWorker);
    dom.window.navigator.clipboard = { writeText: vi.fn(() => Promise.resolve()) };

    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const icons = dom.window.document.querySelectorAll('.copy-icon');
    expect(icons).toHaveLength(2);

    icons[1].dispatchEvent(new dom.window.Event('click'));
    expect(dom.window.navigator.clipboard.writeText).toHaveBeenCalledWith('def');
    await flush(); // writeText()'s .then() lands as a microtask, not synchronously
    expect(icons[1].textContent).toBe('✓');

    // Only the clicked row's icon changes — its sibling stays untouched.
    expect(icons[0].textContent).toBe('⧉');
  });

  it('is keyboard-operable (Enter/Space), same as a real button', async () => {
    const dom = await setupTextToolPage(FlatTableTextWorker);
    dom.window.navigator.clipboard = { writeText: vi.fn(() => Promise.resolve()) };

    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const icon = dom.window.document.querySelectorAll('.copy-icon')[0];
    const event = new dom.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    icon.dispatchEvent(event);
    expect(dom.window.navigator.clipboard.writeText).toHaveBeenCalledWith('abc');
  });

  it('shows a fallback instead of silently doing nothing when navigator.clipboard does not exist', async () => {
    const dom = await setupTextToolPage(FlatTableTextWorker);
    expect(dom.window.navigator.clipboard).toBeUndefined();

    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const icon = dom.window.document.querySelectorAll('.copy-icon')[0];
    icon.dispatchEvent(new dom.window.Event('click'));
    expect(icon.textContent).toBe('!');
  });
});

// Tool UI audit round 2, §4: a hard content limit (Barcode Generator's 80
// characters, QR Code Generator's ~2,331 bytes) used to only ever surface as
// a rejection after clicking Convert. TOOL_CONFIG's optional
// input_max_length/input_max_bytes turn #char-count/#byte-count into a live
// gauge instead, so the limit is visible before the click.
describe('shared-text.js — character/byte limit gauge (tool UI audit round 2, §4)', () => {
  it('keeps the plain "N chars"/"N Bytes" counters when no limit is declared', async () => {
    const dom = await setupTextToolPage(IdentityTextWorker);
    const input = dom.window.document.getElementById('text-input');
    input.value = 'hello';
    input.dispatchEvent(new dom.window.Event('input'));

    const charCount = dom.window.document.getElementById('char-count');
    const byteCount = dom.window.document.getElementById('byte-count');
    expect(charCount.textContent).toBe('5 chars');
    expect(byteCount.textContent).toBe('5 Bytes');
    expect(charCount.className).toBe('');
    expect(byteCount.className).toBe('');
  });

  it('drives #char-count as a count/max gauge when input_max_length is set, coloring it as the limit is approached and exceeded', async () => {
    const dom = await setupTextToolPage(IdentityTextWorker);
    dom.window.TOOL_CONFIG.input_max_length = 10;
    const input = dom.window.document.getElementById('text-input');
    const charCount = dom.window.document.getElementById('char-count');

    input.value = '12345'; // 5/10 — under the 80% warn threshold
    input.dispatchEvent(new dom.window.Event('input'));
    expect(charCount.textContent).toBe('5 / 10 chars');
    expect(charCount.classList.contains('limit-ok')).toBe(true);

    input.value = '123456789'; // 9/10 — past 80%, not yet over
    input.dispatchEvent(new dom.window.Event('input'));
    expect(charCount.textContent).toBe('9 / 10 chars');
    expect(charCount.classList.contains('limit-warn')).toBe(true);

    input.value = '12345678901'; // 11/10 — over the limit
    input.dispatchEvent(new dom.window.Event('input'));
    expect(charCount.textContent).toBe('11 / 10 chars');
    expect(charCount.classList.contains('limit-over')).toBe(true);
  });

  it('drives #byte-count as a count/max gauge when input_max_bytes is set instead', async () => {
    const dom = await setupTextToolPage(IdentityTextWorker);
    dom.window.TOOL_CONFIG.input_max_bytes = 10;
    const input = dom.window.document.getElementById('text-input');
    const byteCount = dom.window.document.getElementById('byte-count');

    input.value = '12345678901'; // 11 bytes > 10
    input.dispatchEvent(new dom.window.Event('input'));
    expect(byteCount.textContent).toBe('11 / 10 Bytes');
    expect(byteCount.classList.contains('limit-over')).toBe(true);
  });
});

// Tool UI audit round 2, §2: a number-kind input can declare input_presets
// (tools/uuid-generator.yaml's 1/5/10/25/50/100) — quick-pick chips that
// render into #number-presets but, until now, had no click wiring at all.
describe('shared-text.js — number-input presets (tool UI audit round 2, §2)', () => {
  function numberToolPageHtml() {
    return `
      <input id="text-input" type="number" value="5">
      <span id="char-count"></span>
      <span id="byte-count"></span>
      <div id="number-presets">
        <button type="button" class="chip" data-value="1">1</button>
        <button type="button" class="chip chip--active" data-value="5">5</button>
        <button type="button" class="chip" data-value="10">10</button>
      </div>
      <button id="convert-btn"></button>
      <div id="progress" class="hidden"><div id="progress-fill"></div></div>
      <div id="text-result" class="hidden">
        <div id="result-info"></div>
        <div id="text-output-table" class="hidden"></div>
        <div id="text-output-editor"><textarea id="text-output"></textarea></div>
        <img id="text-image-preview" class="hidden" alt="Converted image preview">
        <button id="copy-btn">Copy to Clipboard</button>
        <button id="download-btn"></button>
      </div>
      <button id="reset-btn"></button>
      <div id="error-msg" class="hidden"></div>
      <button id="format-btn" class="hidden"></button>
      <div id="a11y-status"></div>
    `;
  }

  async function setupNumberToolPage() {
    const dom = createDom(numberToolPageHtml());
    dom.window.gtag = vi.fn();
    dom.window.Worker = IdentityTextWorker;
    evalScript(dom, 'fc-util.js');
    dom.window.TOOL_CONFIG = {
      id: 'uuid-generator',
      ui_type: 'text-input',
      input_format: 'Count',
      output_format: 'UUID',
      type: 'client-side',
      max_file_size_bytes: 5 * 1024 * 1024,
      max_file_size: '5MB',
      text_converter_src: '/js/converters/uuid-generator.js',
      text_converter_worker_src: '/js/workers/text-converter-worker.js'
    };
    await boot(dom, 'shared-text.js');
    return dom;
  }

  it('sets the number input’s value and marks the clicked chip active (class + aria-pressed) on click', async () => {
    const dom = await setupNumberToolPage();
    const input = dom.window.document.getElementById('text-input');
    const chips = dom.window.document.querySelectorAll('.chip');

    chips[2].dispatchEvent(new dom.window.Event('click')); // "10"
    expect(input.value).toBe('10');
    expect(chips[2].classList.contains('chip--active')).toBe(true);
    expect(chips[2].getAttribute('aria-pressed')).toBe('true');
    expect(chips[1].classList.contains('chip--active')).toBe(false); // was "5"
    expect(chips[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('re-syncs which chip is active when the value is typed directly, and clears it for a value with no matching chip', async () => {
    const dom = await setupNumberToolPage();
    const input = dom.window.document.getElementById('text-input');
    const chips = dom.window.document.querySelectorAll('.chip');

    input.value = '1';
    input.dispatchEvent(new dom.window.Event('input'));
    expect(chips[0].classList.contains('chip--active')).toBe(true);
    expect(chips[1].classList.contains('chip--active')).toBe(false);

    input.value = '42';
    input.dispatchEvent(new dom.window.Event('input'));
    expect(dom.window.document.querySelectorAll('.chip--active')).toHaveLength(0);
  });
});
