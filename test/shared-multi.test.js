import { describe, expect, it, vi } from 'vitest';
import { boot, createDom, evalScript, flush } from './helpers.js';

// Tool UI audit §1 (P0): setState() unconditionally hides #error-msg, so a
// call site that did showError() THEN setState() had the message shown and
// immediately re-hidden in the same tick — the user never saw it. Both
// addFiles() (a mixed valid/invalid file batch) and startConversion()'s
// batch-catch path used to do this. Fixed by reordering setState() first.

function toolPageHtml() {
  return `
    <div id="upload-zone"></div>
    <input id="file-input" type="file" multiple />
    <div id="file-list" class="hidden"></div>
    <span id="file-list-count" class="hidden"></span>
    <button id="convert-btn"></button>
    <button id="cancel-btn" class="hidden"></button>
    <div id="progress" class="hidden"><div id="progress-fill"></div></div>
    <div id="multi-result" class="hidden">
      <div id="result-summary"></div>
      <div id="result-actions"></div>
    </div>
    <div id="error-msg" class="hidden"></div>
    <div id="a11y-status"></div>
  `;
}

async function setupToolPage(overrides) {
  const dom = createDom(toolPageHtml());
  dom.window.gtag = vi.fn();
  evalScript(dom, 'fc-util.js');
  dom.window.TOOL_CONFIG = Object.assign(
    {
      id: 'bulk-image-compress',
      input_format: 'Image',
      output_format: 'Image',
      type: 'client-side',
      ui_type: 'multi-file',
      accept_extensions: ['.jpg', '.png'],
      max_file_size_bytes: 25 * 1024 * 1024,
      max_file_size: '25MB',
      max_files: 10,
      output_extension: '.jpg'
    },
    overrides
  );
  await boot(dom, 'shared-multi.js');
  return dom;
}

function makeFile(dom, name, sizeBytes) {
  return new dom.window.File([new Uint8Array(sizeBytes)], name, { type: 'image/jpeg' });
}

function selectFiles(dom, files) {
  const input = dom.window.document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

describe('shared-multi.js — error visibility (tool UI audit §1)', () => {
  it('keeps the error visible when a batch has both valid and invalid files', async () => {
    const dom = await setupToolPage();
    const good = makeFile(dom, 'photo.jpg', 1024);
    const bad = makeFile(dom, 'notes.txt', 1024);

    selectFiles(dom, [good, bad]);
    await flush();

    const errorMsg = dom.window.document.getElementById('error-msg');
    // The bug: setState('selected') (run because the valid file makes
    // selectedFiles.length > 0) used to run AFTER showError() and wipe it
    // via its unconditional els.errorMsg.classList.add('hidden').
    expect(errorMsg.classList.contains('hidden')).toBe(false);
    expect(errorMsg.textContent).toContain('notes.txt');
    expect(errorMsg.textContent).toContain('wrong format');

    // The valid file should still be listed and selectable — the bug report
    // only ever hid the ERROR, it didn't lose the valid file.
    const fileList = dom.window.document.getElementById('file-list');
    expect(fileList.textContent).toContain('photo.jpg');
    expect(dom.window.document.getElementById('convert-btn').disabled).toBe(false);
  });

  it('still shows the error with no valid files in the batch (pre-existing working case)', async () => {
    const dom = await setupToolPage();
    const bad = makeFile(dom, 'notes.txt', 1024);

    selectFiles(dom, [bad]);
    await flush();

    const errorMsg = dom.window.document.getElementById('error-msg');
    expect(errorMsg.classList.contains('hidden')).toBe(false);
    expect(errorMsg.textContent).toContain('notes.txt');
  });

  it('shows the max-files error and keeps it visible when the batch overflows', async () => {
    const dom = await setupToolPage({ max_files: 2 });
    const files = [
      makeFile(dom, 'a.jpg', 1024),
      makeFile(dom, 'b.jpg', 1024),
      makeFile(dom, 'c.jpg', 1024)
    ];

    selectFiles(dom, files);
    await flush();

    const errorMsg = dom.window.document.getElementById('error-msg');
    expect(errorMsg.classList.contains('hidden')).toBe(false);
    expect(errorMsg.textContent).toContain('Maximum 2 files allowed');
  });

  it('keeps the error visible and announces it when the batch converter rejects', async () => {
    const dom = await setupToolPage();
    dom.window.convertFiles = function () {
      return Promise.reject(new Error('One of these files is corrupted.'));
    };

    const good = makeFile(dom, 'photo.jpg', 1024);
    selectFiles(dom, [good]);
    await flush();
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    const errorMsg = dom.window.document.getElementById('error-msg');
    expect(errorMsg.classList.contains('hidden')).toBe(false);
    expect(errorMsg.textContent).toBe('One of these files is corrupted.');

    // The bug also silently ate the screen-reader announcement: showError(msg)
    // set #a11y-status's text, then setState('selected') right after called
    // announceState('selected'), which clears the live region back to '' (its
    // branch only sets text for 'converting'/'complete'). Reordering to
    // setState() first, showError() last, means showError()'s own
    // els.status.textContent assignment is what actually lands.
    const status = dom.window.document.getElementById('a11y-status');
    expect(status.textContent).toBe('One of these files is corrupted.');

    // State should have reverted to 'selected', not stuck mid-conversion.
    expect(dom.window.document.getElementById('convert-btn').disabled).toBe(false);
    expect(dom.window.document.getElementById('progress').classList.contains('hidden')).toBe(true);
  });

  it('still completes normally for an all-valid batch (regression baseline)', async () => {
    const dom = await setupToolPage();
    dom.window.convertFiles = function (files) {
      return Promise.resolve({
        blob: new dom.window.Blob([new Uint8Array(512)], { type: 'application/zip' }),
        filename: 'compressed.zip'
      });
    };

    const good = makeFile(dom, 'photo.jpg', 1024);
    selectFiles(dom, [good]);
    await flush();
    dom.window.document.getElementById('convert-btn').click();
    await flush();
    await flush();

    expect(dom.window.document.getElementById('error-msg').classList.contains('hidden')).toBe(true);
    expect(dom.window.document.getElementById('multi-result').classList.contains('hidden')).toBe(
      false
    );
    expect(dom.window.document.getElementById('result-summary').textContent).toContain(
      '1 of 1 files converted'
    );
  });
});
