import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

var UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('uuid-generator.js — window.convertText', () => {
  it('generates 1 UUID when input is empty', () => {
    const dom = createDom();
    evalScript(dom, 'converters/uuid-generator.js');

    const { text, filename } = dom.window.convertText('');

    expect(filename).toBe('uuids.txt');
    const lines = text.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(UUID_V4_RE);
  });

  it('generates the requested count of valid v4 UUIDs', () => {
    const dom = createDom();
    evalScript(dom, 'converters/uuid-generator.js');

    const { text } = dom.window.convertText('5');
    const lines = text.split('\n');

    expect(lines).toHaveLength(5);
    lines.forEach((line) => {
      expect(line).toMatch(UUID_V4_RE);
    });
  });

  it('generates unique values across a batch', () => {
    const dom = createDom();
    evalScript(dom, 'converters/uuid-generator.js');

    const { text } = dom.window.convertText('50');
    const lines = text.split('\n');

    expect(new Set(lines).size).toBe(50);
  });

  it('rejects a count below the minimum', () => {
    const dom = createDom();
    evalScript(dom, 'converters/uuid-generator.js');

    expect(() => dom.window.convertText('0')).toThrow(/between 1 and 100/);
  });

  it('rejects a count above the maximum', () => {
    const dom = createDom();
    evalScript(dom, 'converters/uuid-generator.js');

    expect(() => dom.window.convertText('101')).toThrow(/between 1 and 100/);
  });

  it('rejects a non-numeric count', () => {
    const dom = createDom();
    evalScript(dom, 'converters/uuid-generator.js');

    expect(() => dom.window.convertText('abc')).toThrow(/whole number/);
  });

  it('rejects a non-integer count', () => {
    const dom = createDom();
    evalScript(dom, 'converters/uuid-generator.js');

    expect(() => dom.window.convertText('2.5')).toThrow(/whole number/);
  });
});
