import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript } from './helpers.js';

function toolPageWithQualitySlider(value) {
  return createDom(`<input id="opt-quality" value="${value}" />`);
}

describe('image-compress.js — window.convertFile', () => {
  it('maps the quality slider to imageCompression options and wraps the result', async () => {
    const dom = toolPageWithQualitySlider('60');
    const compressed = { type: 'image/jpeg' };
    dom.window.imageCompression = vi.fn().mockResolvedValue(compressed);
    evalScript(dom, 'converters/image-compress.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    const blob = await dom.window.convertFile(file);

    expect(dom.window.imageCompression).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        maxSizeMB: 5, // quality 60 is in the 50-89 band
        maxWidthOrHeight: 4096,
        useWebWorker: true,
        initialQuality: 0.6,
        fileType: 'image/jpeg'
      })
    );
    expect(blob).toBeInstanceOf(dom.window.Blob);
    expect(blob.type).toBe('image/jpeg');
  });

  it('keeps PNG as the output type (never forces JPEG on a PNG input)', async () => {
    const dom = toolPageWithQualitySlider('75');
    dom.window.imageCompression = vi.fn().mockResolvedValue({ type: 'image/png' });
    evalScript(dom, 'converters/image-compress.js');

    const file = new dom.window.File([new Uint8Array(10)], 'graphic.png', { type: 'image/png' });
    await dom.window.convertFile(file);

    expect(dom.window.imageCompression.mock.calls[0][1].fileType).toBe('image/png');
  });

  it('raises the size budget to 10MB at quality 90+ and lowers it to 2MB below 50', async () => {
    const highDom = toolPageWithQualitySlider('95');
    highDom.window.imageCompression = vi.fn().mockResolvedValue({ type: 'image/jpeg' });
    evalScript(highDom, 'converters/image-compress.js');
    await highDom.window.convertFile(
      new highDom.window.File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' })
    );
    expect(highDom.window.imageCompression.mock.calls[0][1].maxSizeMB).toBe(10);

    const lowDom = toolPageWithQualitySlider('20');
    lowDom.window.imageCompression = vi.fn().mockResolvedValue({ type: 'image/jpeg' });
    evalScript(lowDom, 'converters/image-compress.js');
    await lowDom.window.convertFile(
      new lowDom.window.File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' })
    );
    expect(lowDom.window.imageCompression.mock.calls[0][1].maxSizeMB).toBe(2);
  });

  it('defaults to quality 75 when the slider is missing', async () => {
    const dom = createDom();
    dom.window.imageCompression = vi.fn().mockResolvedValue({ type: 'image/jpeg' });
    evalScript(dom, 'converters/image-compress.js');

    const file = new dom.window.File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
    await dom.window.convertFile(file);

    expect(dom.window.imageCompression.mock.calls[0][1].initialQuality).toBe(0.75);
  });
});
