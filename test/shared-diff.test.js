import { describe, expect, it, vi } from 'vitest';
import { boot, createDom, evalScript, flush } from './helpers.js';

// Mirrors shared-text-worker.test.js's coverage of shared-text.js, but for
// the two-input diff controller (shared-diff.js) and its dedicated worker
// contract ({ textA, textB } in, not the single-input { text }).

function toolPageHtml() {
  return `
    <textarea id="text-input-a"></textarea>
    <textarea id="text-input-b"></textarea>
    <span id="char-count-a"></span>
    <span id="byte-count-a"></span>
    <span id="char-count-b"></span>
    <span id="byte-count-b"></span>
    <button id="convert-btn"></button>
    <div id="progress" class="hidden"><div id="progress-fill"></div></div>
    <div id="text-result" class="hidden">
      <div id="diff-summary" class="hidden"></div>
      <div id="diff-report" class="hidden"></div>
      <div id="text-output-editor">
        <textarea id="text-output"></textarea>
      </div>
      <div id="result-info"></div>
      <button id="copy-btn"></button>
      <button id="download-btn"></button>
    </div>
    <button id="reset-btn"></button>
    <div id="error-msg" class="hidden"></div>
    <div id="a11y-status"></div>
  `;
}

class FakeDiffWorker {
  constructor(url) {
    this.url = url;
  }
  postMessage(msg) {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({
          data: {
            ok: true,
            result: { text: msg.textA.length + ' vs ' + msg.textB.length, filename: 'diff.txt' }
          }
        });
      }
    }, 0);
  }
  terminate() {}
}

class FakeStructuredDiffWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({
          data: {
            ok: true,
            result: {
              text: '2 differences found:\n\n+ $.b: 2 (added)\n~ $.a: 1 → 3\n',
              filename: 'diff.txt',
              diffs: [
                { kind: 'added', path: '$.b', newDesc: '2' },
                { kind: 'changed', path: '$.a', oldDesc: '1', newDesc: '3' }
              ],
              summary: { added: 1, removed: 0, changed: 1 }
            }
          }
        });
      }
    }, 0);
  }
  terminate() {}
}

class FakeIdenticalDiffWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({
          data: {
            ok: true,
            result: {
              text: 'No differences — both JSON values are structurally identical.\n',
              filename: 'diff.txt',
              diffs: [],
              summary: { added: 0, removed: 0, changed: 0 }
            }
          }
        });
      }
    }, 0);
  }
  terminate() {}
}

class FakeFailingDiffWorker {
  postMessage() {
    var self = this;
    setTimeout(function () {
      if (self.onmessage) {
        self.onmessage({ data: { ok: false, error: 'Left JSON is invalid.' } });
      }
    }, 0);
  }
  terminate() {}
}

async function setupDiffToolPage(WorkerClass) {
  const dom = createDom(toolPageHtml());
  dom.window.gtag = vi.fn();
  dom.window.Worker = WorkerClass;
  evalScript(dom, 'fc-util.js');
  dom.window.TOOL_CONFIG = {
    id: 'json-diff',
    ui_type: 'text-diff',
    input_format: 'JSON',
    output_format: 'JSON',
    type: 'client-side',
    max_file_size_bytes: 5 * 1024 * 1024,
    max_file_size: '5MB',
    text_converter_src: '/js/converters/json-diff.js',
    text_converter_worker_src: '/js/workers/text-diff-worker.js'
  };
  await boot(dom, 'shared-diff.js');
  return dom;
}

describe('shared-diff.js — two-input worker-based comparison', () => {
  it('sends both inputs to the worker and shows the result', async () => {
    const dom = await setupDiffToolPage(FakeDiffWorker);
    dom.window.document.getElementById('text-input-a').value = '{"a":1}';
    dom.window.document.getElementById('text-input-a').dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('text-input-b').value = '{"a":2}';
    dom.window.document.getElementById('text-input-b').dispatchEvent(new dom.window.Event('input'));

    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const output = dom.window.document.getElementById('text-output');
    expect(output.value).toBe('7 vs 7');
    expect(dom.window.document.getElementById('text-result').classList.contains('hidden')).toBe(
      false
    );
  });

  it('constructs the worker URL with the converter passed as a query param', async () => {
    let capturedUrl = null;
    class CapturingWorker extends FakeDiffWorker {
      constructor(url) {
        super(url);
        capturedUrl = url;
      }
    }
    const dom = await setupDiffToolPage(CapturingWorker);
    dom.window.document.getElementById('text-input-a').value = 'a';
    dom.window.document.getElementById('text-input-a').dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('text-input-b').value = 'b';
    dom.window.document.getElementById('text-input-b').dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('convert-btn').click();
    await flush();

    expect(capturedUrl).toBe(
      '/js/workers/text-diff-worker.js?converter=%2Fjs%2Fconverters%2Fjson-diff.js'
    );
  });

  it('disables Compare until both inputs have content', async () => {
    const dom = await setupDiffToolPage(FakeDiffWorker);
    const convertBtn = dom.window.document.getElementById('convert-btn');
    expect(convertBtn.disabled).toBe(true);

    dom.window.document.getElementById('text-input-a').value = 'a';
    dom.window.document.getElementById('text-input-a').dispatchEvent(new dom.window.Event('input'));
    expect(convertBtn.disabled).toBe(true);

    dom.window.document.getElementById('text-input-b').value = 'b';
    dom.window.document.getElementById('text-input-b').dispatchEvent(new dom.window.Event('input'));
    expect(convertBtn.disabled).toBe(false);
  });

  it('renders a colored summary and report when the converter returns structured diffs', async () => {
    const dom = await setupDiffToolPage(FakeStructuredDiffWorker);
    dom.window.document.getElementById('text-input-a').value = '{"a":1}';
    dom.window.document.getElementById('text-input-a').dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('text-input-b').value = '{"a":3,"b":2}';
    dom.window.document.getElementById('text-input-b').dispatchEvent(new dom.window.Event('input'));

    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const doc = dom.window.document;
    expect(doc.getElementById('diff-summary').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('diff-report').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('text-output-editor').classList.contains('hidden')).toBe(true);

    const chips = doc.querySelectorAll('#diff-summary .diff-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe('1 added');
    expect(chips[1].textContent).toBe('1 changed');

    const rows = doc.querySelectorAll('#diff-report .diff-row');
    expect(rows.length).toBe(2);
    expect(rows[0].classList.contains('diff-row--added')).toBe(true);
    expect(rows[1].classList.contains('diff-row--changed')).toBe(true);

    expect(doc.getElementById('a11y-status').textContent).toBe(
      'Comparison complete. 1 added, 1 changed.'
    );
  });

  it('shows a "no differences" chip and no report rows for identical JSON', async () => {
    const dom = await setupDiffToolPage(FakeIdenticalDiffWorker);
    dom.window.document.getElementById('text-input-a').value = '{"a":1}';
    dom.window.document.getElementById('text-input-a').dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('text-input-b').value = '{"a":1}';
    dom.window.document.getElementById('text-input-b').dispatchEvent(new dom.window.Event('input'));

    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const doc = dom.window.document;
    expect(doc.getElementById('diff-summary').classList.contains('hidden')).toBe(false);
    const chips = doc.querySelectorAll('#diff-summary .diff-chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toBe('No differences');
    expect(doc.querySelectorAll('#diff-report .diff-row').length).toBe(0);
  });

  it('shows an error and never reveals the result panel when the worker reports failure', async () => {
    const dom = await setupDiffToolPage(FakeFailingDiffWorker);
    dom.window.document.getElementById('text-input-a').value = '{bad';
    dom.window.document.getElementById('text-input-a').dispatchEvent(new dom.window.Event('input'));
    dom.window.document.getElementById('text-input-b').value = '{}';
    dom.window.document.getElementById('text-input-b').dispatchEvent(new dom.window.Event('input'));

    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    expect(dom.window.document.getElementById('error-msg').textContent).toBe(
      'Left JSON is invalid.'
    );
    expect(dom.window.document.getElementById('error-msg').classList.contains('hidden')).toBe(
      false
    );
    expect(dom.window.document.getElementById('text-result').classList.contains('hidden')).toBe(
      true
    );
  });
});
