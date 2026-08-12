import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('json-minifier.js — window.convertText', () => {
  it('strips whitespace down to a single line', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-minifier.js');

    const { text, filename } = dom.window.convertText('{\n  "name": "Alice",\n  "age": 30\n}');

    expect(filename).toBe('minified.json');
    expect(text).toBe('{"name":"Alice","age":30}');
    expect(text).not.toContain('\n');
  });

  it('preserves data exactly (round-trips to the same value)', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-minifier.js');

    const input = { list: [1, 2, { nested: true }], note: null };
    const { text } = dom.window.convertText(JSON.stringify(input, null, 4));

    expect(JSON.parse(text)).toEqual(input);
  });

  it('throws a descriptive error for invalid JSON', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-minifier.js');

    expect(() => dom.window.convertText('{"a":}')).toThrow(/Invalid JSON/);
  });
});
