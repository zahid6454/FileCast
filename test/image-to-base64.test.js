import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('image-to-base64.js — window.convertFile', () => {
  it('encodes the file as a data URL and returns it as a text blob', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/image-to-base64.js');

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new dom.window.File([bytes], 'logo.png', { type: 'image/png' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('text/plain');
    const text = await blob.text();
    expect(text).toMatch(/^data:image\/png;base64,/);

    const base64Part = text.split(',')[1];
    expect(Buffer.from(base64Part, 'base64')).toEqual(Buffer.from(bytes));
  });

  it('rejects when the file cannot be read', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/image-to-base64.js');

    dom.window.FileReader.prototype.readAsDataURL = function () {
      var self = this;
      setTimeout(function () {
        if (self.onerror) self.onerror(new dom.window.Event('error'));
      }, 0);
    };

    const file = new dom.window.File([new Uint8Array([1, 2, 3])], 'broken.png', {
      type: 'image/png'
    });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/failed to read/i);
  });
});
