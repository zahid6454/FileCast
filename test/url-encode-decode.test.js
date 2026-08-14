import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('url-encode-decode.js — window.convertText', () => {
  it('encodes plain text with reserved characters', () => {
    const dom = createDom();
    evalScript(dom, 'converters/url-encode-decode.js');

    const { text, filename } = dom.window.convertText('hello world & more?');

    expect(filename).toBe('encoded.txt');
    expect(text).toBe(encodeURIComponent('hello world & more?'));
  });

  it('decodes a percent-encoded string back to plain text', () => {
    const dom = createDom();
    evalScript(dom, 'converters/url-encode-decode.js');

    const { text, filename } = dom.window.convertText('hello%20world%20%26%20more%3F');

    expect(filename).toBe('decoded.txt');
    expect(text).toBe('hello world & more?');
  });

  it('round-trips Unicode text', () => {
    const dom = createDom();
    evalScript(dom, 'converters/url-encode-decode.js');

    const original = 'café résumé 日本語';
    const { text: encoded } = dom.window.convertText(original);
    const { text: decoded } = dom.window.convertText(encoded);

    expect(decoded).toBe(original);
  });

  it('encodes text with no percent sequences at all', () => {
    const dom = createDom();
    evalScript(dom, 'converters/url-encode-decode.js');

    const { text, filename } = dom.window.convertText('plain-text_no-escapes');

    expect(filename).toBe('encoded.txt');
    expect(text).toBe('plain-text_no-escapes');
  });

  it('falls back to encoding when a %XX sequence is not valid UTF-8', () => {
    const dom = createDom();
    evalScript(dom, 'converters/url-encode-decode.js');

    // %80 alone is a stray UTF-8 continuation byte — decodeURIComponent throws.
    const { text, filename } = dom.window.convertText('50%80 off');

    expect(filename).toBe('encoded.txt');
    expect(text).toBe(encodeURIComponent('50%80 off'));
  });
});
