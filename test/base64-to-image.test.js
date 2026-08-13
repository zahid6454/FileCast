import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// A minimal valid 1x1 transparent PNG, Base64-encoded.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('base64-to-image.js — window.convertText', () => {
  it('decodes a raw Base64 PNG string and detects the format', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-to-image.js');

    const { text, filename } = dom.window.convertText(PNG_BASE64);

    expect(filename).toBe('image.png');
    expect(text).toBe('data:image/png;base64,' + PNG_BASE64);
  });

  it('accepts a full data: URL and re-detects the real format from bytes', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-to-image.js');

    // Deliberately mislabeled as image/jpeg — the tool should trust the bytes.
    const { text, filename } = dom.window.convertText('data:image/jpeg;base64,' + PNG_BASE64);

    expect(filename).toBe('image.png');
    expect(text).toBe('data:image/png;base64,' + PNG_BASE64);
  });

  it('strips whitespace/newlines from a multi-line pasted Base64 string', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-to-image.js');

    const wrapped = PNG_BASE64.match(/.{1,20}/g).join('\n');
    const { filename } = dom.window.convertText(wrapped);

    expect(filename).toBe('image.png');
  });

  it('throws a descriptive error for invalid Base64', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-to-image.js');

    expect(() => dom.window.convertText('not!!valid==base64')).toThrow(/valid Base64/);
  });

  it('throws a descriptive error when decoded bytes are not a recognized image', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-to-image.js');

    const plainTextBase64 = Buffer.from('just some plain text').toString('base64');
    expect(() => dom.window.convertText(plainTextBase64)).toThrow(/not a recognized image format/);
  });

  it('throws when the data URL is missing the ;base64 marker', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-to-image.js');

    expect(() => dom.window.convertText('data:image/png,notbase64')).toThrow(/not Base64-encoded/);
  });
});
