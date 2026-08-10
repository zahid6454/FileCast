import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript } from './helpers.js';

function toolPageWithQualitySlider(value) {
  return createDom(`<input id="opt-quality" value="${value}" />`);
}

describe('bulk-image-compress.js — window.convertFile', () => {
  it('maps the quality slider to imageCompression options and wraps the result', async () => {
    const dom = toolPageWithQualitySlider('60');
    dom.window.imageCompression = vi.fn().mockResolvedValue({ type: 'image/jpeg' });
    evalScript(dom, 'converters/bulk-image-compress.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    const blob = await dom.window.convertFile(file);

    expect(dom.window.imageCompression).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        maxSizeMB: 5,
        maxWidthOrHeight: 4096,
        useWebWorker: true,
        initialQuality: 0.6,
        fileType: 'image/jpeg'
      })
    );
    expect(blob).toBeInstanceOf(dom.window.Blob);
  });

  it('keeps PNG as the output type', async () => {
    const dom = toolPageWithQualitySlider('75');
    dom.window.imageCompression = vi.fn().mockResolvedValue({ type: 'image/png' });
    evalScript(dom, 'converters/bulk-image-compress.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    await dom.window.convertFile(file);

    expect(dom.window.imageCompression.mock.calls[0][1].fileType).toBe('image/png');
  });

  it('defaults to quality 75 when the slider is missing', async () => {
    const dom = createDom();
    dom.window.imageCompression = vi.fn().mockResolvedValue({ type: 'image/jpeg' });
    evalScript(dom, 'converters/bulk-image-compress.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    expect(dom.window.imageCompression.mock.calls[0][1].initialQuality).toBe(0.75);
  });
});
