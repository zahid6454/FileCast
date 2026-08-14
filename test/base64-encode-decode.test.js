import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('base64-encode-decode.js — window.convertText', () => {
  it('encodes plain text to Base64', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-encode-decode.js');

    const { text, filename } = dom.window.convertText('Hello, World!');

    expect(filename).toBe('encoded.txt');
    expect(text).toBe('SGVsbG8sIFdvcmxkIQ==');
  });

  it('decodes valid Base64 back to plain text', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-encode-decode.js');

    const { text, filename } = dom.window.convertText('SGVsbG8sIFdvcmxkIQ==');

    expect(filename).toBe('decoded.txt');
    expect(text).toBe('Hello, World!');
  });

  it('round-trips Unicode text (emoji, accents)', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-encode-decode.js');

    const original = 'café ☕ 日本語';
    const { text: encoded } = dom.window.convertText(original);
    const { text: decoded } = dom.window.convertText(encoded);

    expect(decoded).toBe(original);
  });

  it('encodes text that merely looks like it could be Base64 but is not valid padding/charset', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-encode-decode.js');

    const { text, filename } = dom.window.convertText('not base64 at all!');

    expect(filename).toBe('encoded.txt');
    expect(text).toBe(Buffer.from('not base64 at all!', 'utf-8').toString('base64'));
  });

  it('falls back to encoding when input is valid Base64 shape but decodes to invalid UTF-8', () => {
    const dom = createDom();
    evalScript(dom, 'converters/base64-encode-decode.js');

    // "////" is valid Base64 charset/padding but decodes to non-UTF-8 bytes (0xFF 0xFF 0xFF).
    const { filename } = dom.window.convertText('////');

    expect(filename).toBe('encoded.txt');
  });
});
