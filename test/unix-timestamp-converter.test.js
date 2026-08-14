import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('unix-timestamp-converter.js — window.convertText', () => {
  it('converts a seconds-based Unix timestamp to all formats', () => {
    const dom = createDom();
    evalScript(dom, 'converters/unix-timestamp-converter.js');

    const { text, filename } = dom.window.convertText('1700000000');

    expect(filename).toBe('timestamps.txt');
    expect(text).toContain('Unix (seconds): 1700000000');
    expect(text).toContain('Unix (ms):      1700000000000');
    expect(text).toContain('ISO 8601 (UTC): 2023-11-14T22:13:20.000Z');
  });

  it('auto-detects a millisecond-based Unix timestamp', () => {
    const dom = createDom();
    evalScript(dom, 'converters/unix-timestamp-converter.js');

    const { text } = dom.window.convertText('1700000000000');

    expect(text).toContain('Unix (seconds): 1700000000');
    expect(text).toContain('Unix (ms):      1700000000000');
  });

  it('converts an ISO 8601 date string to a Unix timestamp', () => {
    const dom = createDom();
    evalScript(dom, 'converters/unix-timestamp-converter.js');

    const { text } = dom.window.convertText('2024-01-15T12:00:00Z');

    expect(text).toContain('Unix (seconds): 1705320000');
    expect(text).toContain('ISO 8601 (UTC): 2024-01-15T12:00:00.000Z');
  });

  it('converts multiple lines, skipping blanks', () => {
    const dom = createDom();
    evalScript(dom, 'converters/unix-timestamp-converter.js');

    const { text } = dom.window.convertText('0\n\n1700000000\n');
    const blocks = text.split('\n\n').filter((b) => b.trim());

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('ISO 8601 (UTC): 1970-01-01T00:00:00.000Z');
  });

  it('throws a descriptive, line-numbered error for an unparseable date', () => {
    const dom = createDom();
    evalScript(dom, 'converters/unix-timestamp-converter.js');

    expect(() => dom.window.convertText('1700000000\nnot a date')).toThrow(/Line 2/);
  });

  it('throws when input is entirely empty', () => {
    const dom = createDom();
    evalScript(dom, 'converters/unix-timestamp-converter.js');

    expect(() => dom.window.convertText('   \n')).toThrow(/Enter a Unix timestamp/);
  });
});
