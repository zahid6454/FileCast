import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('number-base-converter.js — window.convertText', () => {
  it('converts a plain decimal number to all four bases', () => {
    const dom = createDom();
    evalScript(dom, 'converters/number-base-converter.js');

    const { text, filename } = dom.window.convertText('255');

    expect(filename).toBe('number-bases.txt');
    expect(text).toContain('Binary:  11111111');
    expect(text).toContain('Decimal: 255');
    expect(text).toContain('Hex:     FF');
    expect(text).toContain('Octal:   377');
  });

  it('detects 0x/0b/0o prefixes and produces identical results for the same value', () => {
    const dom = createDom();
    evalScript(dom, 'converters/number-base-converter.js');

    const { text } = dom.window.convertText('0xFF\n0b11111111\n0o377');
    const blocks = text.split('\n\n');

    expect(blocks).toHaveLength(3);
    blocks.forEach((block) => {
      expect(block).toContain('Decimal: 255');
    });
  });

  it('treats a bare hex-looking value with no prefix as hex', () => {
    const dom = createDom();
    evalScript(dom, 'converters/number-base-converter.js');

    const { text } = dom.window.convertText('FF');

    expect(text).toContain('Decimal: 255');
  });

  it('handles a negative number with a 0x/0b/0o prefix (BigInt string grammar disallows a signed prefixed literal directly)', () => {
    const dom = createDom();
    evalScript(dom, 'converters/number-base-converter.js');

    const { text } = dom.window.convertText('-0xFF\n-0b1010\n-0o17');
    const blocks = text.split('\n\n');

    expect(blocks[0]).toContain('Decimal: -255');
    expect(blocks[1]).toContain('Decimal: -10');
    expect(blocks[2]).toContain('Decimal: -15');
  });

  it('handles a negative bare-hex value with no prefix', () => {
    const dom = createDom();
    evalScript(dom, 'converters/number-base-converter.js');

    const { text } = dom.window.convertText('-FF');

    expect(text).toContain('Decimal: -255');
  });

  it('preserves the sign for negative numbers across all bases', () => {
    const dom = createDom();
    evalScript(dom, 'converters/number-base-converter.js');

    const { text } = dom.window.convertText('-42');

    expect(text).toContain('Binary:  -101010');
    expect(text).toContain('Decimal: -42');
    expect(text).toContain('Hex:     -2A');
    expect(text).toContain('Octal:   -52');
  });

  it('converts multiple lines and skips blank lines', () => {
    const dom = createDom();
    evalScript(dom, 'converters/number-base-converter.js');

    const { text } = dom.window.convertText('1\n\n2\n');
    const blocks = text.split('\n\n').filter((b) => b.trim());

    expect(blocks).toHaveLength(2);
  });

  it('handles numbers beyond 64-bit precision accurately', () => {
    const dom = createDom();
    evalScript(dom, 'converters/number-base-converter.js');

    const big = '123456789012345678901234567890';
    const { text } = dom.window.convertText(big);

    expect(text).toContain('Decimal: ' + big);
  });

  it('throws a descriptive, line-numbered error for unparseable input', () => {
    const dom = createDom();
    evalScript(dom, 'converters/number-base-converter.js');

    expect(() => dom.window.convertText('255\nnotanumber')).toThrow(/Line 2/);
  });

  it('throws when input is entirely empty', () => {
    const dom = createDom();
    evalScript(dom, 'converters/number-base-converter.js');

    expect(() => dom.window.convertText('   \n  ')).toThrow(/at least one number/);
  });
});
