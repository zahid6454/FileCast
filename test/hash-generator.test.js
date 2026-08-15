import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('hash-generator.js — window.convertText', () => {
  it('computes both MD5 and SHA-256 for empty input', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/hash-generator.js');

    const { text, filename } = await dom.window.convertText('');

    expect(filename).toBe('hashes.txt');
    expect(text).toContain('MD5:     d41d8cd98f00b204e9800998ecf8427e');
    expect(text).toContain(
      'SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('computes the known RFC 1321 / FIPS 180 vectors for "abc"', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/hash-generator.js');

    const { text } = await dom.window.convertText('abc');

    expect(text).toContain('MD5:     900150983cd24fb0d6963f7d28e17f72');
    expect(text).toContain(
      'SHA-256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('produces different hashes for different input', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/hash-generator.js');

    const a = await dom.window.convertText('hello');
    const b = await dom.window.convertText('Hello');

    expect(a.text).not.toBe(b.text);
  });

  it('hashes a multi-block (65+ byte) input correctly', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/hash-generator.js');

    const input = 'x'.repeat(200);
    const { text } = await dom.window.convertText(input);

    expect(text).toContain('MD5:     ');
    expect(text).toContain('SHA-256: ');
    // both digests present at their expected fixed lengths
    expect(text.match(/MD5:\s+([0-9a-f]{32})/)[1]).toHaveLength(32);
    expect(text.match(/SHA-256:\s+([0-9a-f]{64})/)[1]).toHaveLength(64);
  });

  it('hashes multi-byte UTF-8 input consistently with its byte representation', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/hash-generator.js');

    const { text } = await dom.window.convertText('héllo wörld 日本語 🎉');

    expect(text).toContain('MD5:     c178c6a17b1ca5e7d2ced17305d2590e');
    expect(text).toContain(
      'SHA-256: 367e0c956d2fe75a184497fd97a7f715899cc7b96c4b6e727bc89dc5ebd62510'
    );
  });
});
