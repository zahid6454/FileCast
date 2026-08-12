import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('json-formatter.js — window.convertText', () => {
  it('pretty-prints minified JSON with 2-space indentation', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-formatter.js');

    const { text, filename } = dom.window.convertText('{"name":"Alice","age":30}');

    expect(filename).toBe('formatted.json');
    expect(text).toBe(JSON.stringify({ name: 'Alice', age: 30 }, null, 2));
  });

  it('preserves nested structure', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-formatter.js');

    const input = { a: { b: [1, 2, { c: 3 }] } };
    const { text } = dom.window.convertText(JSON.stringify(input));

    expect(JSON.parse(text)).toEqual(input);
    expect(text).toContain('\n');
  });

  it('throws a descriptive error for invalid JSON', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-formatter.js');

    expect(() => dom.window.convertText('{not valid json')).toThrow(/Invalid JSON/);
  });
});
