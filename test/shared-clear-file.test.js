import { describe, expect, it, vi } from 'vitest';
import { boot, createDom, evalScript, flush } from './helpers.js';

// The file-info card's × (file-remove-btn) — lets a user back out of a wrong
// file selection without reloading the page. Only meant to be usable in the
// 'selected' state; Cancel and "Convert Another" already own clearing during
// 'converting'/'complete'.

function toolPageHtml() {
  return `
    <div id="upload-zone"></div>
    <input id="file-input" type="file" />
    <div id="file-info" class="hidden">
      <img id="file-preview" class="hidden" />
      <span id="file-name"></span>
      <span id="file-size"></span>
      <button id="file-remove-btn" class="hidden" aria-label="Remove selected file"></button>
    </div>
    <button id="convert-btn"></button>
    <div id="progress" class="hidden">
      <div id="progress-fill"></div>
      <span id="progress-label"></span>
    </div>
    <div id="result" class="hidden">
      <div id="result-info"></div>
      <div class="result__actions"></div>
      <button id="download-btn"></button>
    </div>
    <button id="reset-btn"></button>
    <button id="cancel-btn" class="hidden"></button>
    <div id="error-msg" class="hidden"></div>
    <div id="a11y-status"></div>
  `;
}

async function setupToolPage() {
  const dom = createDom(toolPageHtml());
  dom.window.gtag = vi.fn();
  evalScript(dom, 'fc-util.js');
  dom.window.TOOL_CONFIG = {
    id: 'heic-to-jpg',
    input_format: 'HEIC',
    output_format: 'JPG',
    type: 'client-side',
    ui_type: 'standard',
    accept_extensions: ['.heic'],
    max_file_size_bytes: 25 * 1024 * 1024,
    max_file_size: '25MB',
    output_extension: '.jpg'
  };
  await boot(dom, 'shared.js');
  return dom;
}

function selectFile(dom, file) {
  const input = dom.window.document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

function fileClearedEvent(dom) {
  return dom.window.gtag.mock.calls.find((c) => c[1] === 'file_cleared');
}

describe('shared.js — clearing a selected file via file-remove-btn', () => {
  it('shows the remove button once a file is selected, hidden before that', async () => {
    const dom = await setupToolPage();
    const removeBtn = dom.window.document.getElementById('file-remove-btn');
    expect(removeBtn.classList.contains('hidden')).toBe(true);

    selectFile(
      dom,
      new dom.window.File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' })
    );
    expect(removeBtn.classList.contains('hidden')).toBe(false);
  });

  it('clicking it clears the selection and returns to the empty/upload-zone state', async () => {
    const dom = await setupToolPage();
    const doc = dom.window.document;
    const input = doc.getElementById('file-input');

    selectFile(
      dom,
      new dom.window.File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' })
    );
    expect(doc.getElementById('file-info').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('convert-btn').disabled).toBe(false);

    doc.getElementById('file-remove-btn').click();

    expect(doc.getElementById('file-info').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('upload-zone').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('convert-btn').disabled).toBe(true);
    expect(input.value).toBe('');
    expect(fileClearedEvent(dom)).toBeDefined();
    expect(fileClearedEvent(dom)[2]).toEqual({ tool_id: 'heic-to-jpg' });
  });

  it('lets a new file be selected immediately after clearing (no stale state)', async () => {
    const dom = await setupToolPage();
    const doc = dom.window.document;

    selectFile(
      dom,
      new dom.window.File([new Uint8Array(10)], 'first.heic', { type: 'image/heic' })
    );
    doc.getElementById('file-remove-btn').click();
    selectFile(
      dom,
      new dom.window.File([new Uint8Array(20)], 'second.heic', { type: 'image/heic' })
    );

    expect(doc.getElementById('file-name').textContent).toBe('second.heic');
    expect(doc.getElementById('convert-btn').disabled).toBe(false);
    expect(doc.getElementById('file-info').classList.contains('hidden')).toBe(false);
  });

  it('is hidden again once conversion starts, and does not clear an in-flight conversion', async () => {
    const dom = await setupToolPage();
    const doc = dom.window.document;
    let resolveConvert;
    dom.window.convertFile = () =>
      new Promise((resolve) => {
        resolveConvert = resolve;
      });

    selectFile(
      dom,
      new dom.window.File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' })
    );
    doc.getElementById('convert-btn').click();
    await flush();

    const removeBtn = doc.getElementById('file-remove-btn');
    expect(removeBtn.classList.contains('hidden')).toBe(true);

    // Even if something dispatches a click while it's hidden, the 'selected'-only
    // guard in clearSelectedFile() must not tear down an in-flight conversion.
    removeBtn.click();
    expect(doc.getElementById('progress').classList.contains('hidden')).toBe(false);

    resolveConvert(new dom.window.Blob([new Uint8Array(5)], { type: 'image/jpeg' }));
    await flush();
  });

  it('stays hidden in the complete state ("Convert Another" owns clearing there)', async () => {
    const dom = await setupToolPage();
    const doc = dom.window.document;
    dom.window.convertFile = () =>
      Promise.resolve(new dom.window.Blob([new Uint8Array(5)], { type: 'image/jpeg' }));

    selectFile(
      dom,
      new dom.window.File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' })
    );
    doc.getElementById('convert-btn').click();
    await flush();
    await flush();

    expect(doc.getElementById('result').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('file-remove-btn').classList.contains('hidden')).toBe(true);
  });
});
