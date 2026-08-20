import { describe, expect, it } from 'vitest';
import { createDom, evalScript, mockCanvas, mockImageLoad } from './helpers.js';

// png-to-ico.js and ico-to-png.js are two independent, hand-rolled
// implementations of the same binary ICO container format — nothing else in
// this codebase validates that they actually agree on the byte layout.
// Unit tests for each converter alone (png-to-ico.test.js, ico-to-png.test.js)
// only check each one's output against a hand-built expectation, which
// would not catch a bug present identically in both the writer and the
// reader. This test drives the real writer's output through the real
// reader, the same way Prompt 4's crypto tests and Prompt 5's
// markdown-parser-consistency test cross-verify two independent
// implementations of a shared format.
const FAKE_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('png-to-ico.js -> ico-to-png.js round trip', () => {
  it('an ICO built by png-to-ico.js is correctly read back by ico-to-png.js', async () => {
    const dom = createDom();
    mockImageLoad(dom.window, { width: 128, height: 128 });
    mockCanvas(dom.window, { blobContent: FAKE_PNG_BYTES });
    evalScript(dom, 'converters/png-to-ico.js');
    const convertPngToIco = dom.window.convertFile;

    const pngFile = new dom.window.File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    const icoBlob = await convertPngToIco(pngFile);
    expect(icoBlob.type).toBe('image/x-icon');

    // Loading ico-to-png.js overwrites window.convertFile — capture the
    // png-to-ico function above before this point.
    evalScript(dom, 'converters/ico-to-png.js');
    const convertIcoToPng = dom.window.convertFile;

    const icoBytes = new Uint8Array(await icoBlob.arrayBuffer());
    const icoFile = new dom.window.File([icoBytes], 'favicon.ico', { type: 'image/x-icon' });
    const pngBlob = await convertIcoToPng(icoFile);

    expect(pngBlob.type).toBe('image/png');
    const resultBytes = new Uint8Array(await pngBlob.arrayBuffer());
    // All 4 rendered sizes share identical mock content, so the extracted
    // image (the 256x256 entry, the largest) must match it exactly.
    expect(Array.from(resultBytes)).toEqual(Array.from(FAKE_PNG_BYTES));
  });
});
