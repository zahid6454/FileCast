import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('heic-to-jpg.js — window.convertFile', () => {
  it('calls heic2any with the file and JPEG output settings, returning its result', async () => {
    const dom = createDom();
    const outputBlob = new dom.window.Blob(['fake-jpeg'], { type: 'image/jpeg' });
    dom.window.heic2any = vi.fn().mockResolvedValue(outputBlob);
    evalScript(dom, 'converters/heic-to-jpg.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' });
    const result = await dom.window.convertFile(file);

    expect(dom.window.heic2any).toHaveBeenCalledWith({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92
    });
    expect(result).toBe(outputBlob);
  });

  it('takes the first blob when heic2any returns an array (multi-image HEIC)', async () => {
    const dom = createDom();
    const first = new dom.window.Blob(['page-1'], { type: 'image/jpeg' });
    const second = new dom.window.Blob(['page-2'], { type: 'image/jpeg' });
    dom.window.heic2any = vi.fn().mockResolvedValue([first, second]);
    evalScript(dom, 'converters/heic-to-jpg.js');

    const file = new dom.window.File([new Uint8Array(10)], 'burst.heic', { type: 'image/heic' });
    const result = await dom.window.convertFile(file);

    expect(result).toBe(first);
  });

  it('propagates a heic2any rejection', async () => {
    const dom = createDom();
    dom.window.heic2any = vi.fn().mockRejectedValue(new Error('Unsupported HEIC variant'));
    evalScript(dom, 'converters/heic-to-jpg.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.heic', { type: 'image/heic' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unsupported heic variant/i);
  });
});
