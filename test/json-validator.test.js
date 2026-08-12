import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('json-validator.js — window.convertText', () => {
  it('confirms valid JSON and echoes it formatted', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-validator.js');

    const { text, filename } = dom.window.convertText('{"name":"Alice","age":30}');

    expect(filename).toBe('validation-result.txt');
    expect(text).toMatch(/^✓ Valid JSON/);
    expect(text).toContain('"name": "Alice"');
  });

  it('throws with a line/column location when the native error reports a character position', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-validator.js');

    // A trailing comma is one of the cases every JS engine's JSON.parse
    // reports with a "position N" offset — exactly the case describeError()
    // converts into a line/column pair.
    const badInput = '{\n  "a": 1,\n  "b": 2,\n}';
    expect(() => dom.window.convertText(badInput)).toThrow(/Invalid JSON — .*line \d+.*column \d+/);
  });

  it('still throws a clear error even when the native message has no position offset', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-validator.js');

    expect(() => dom.window.convertText('{"a": undefined}')).toThrow(/Invalid JSON — /);
  });

  it('rejects trailing commas', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-validator.js');

    expect(() => dom.window.convertText('{"a":1,}')).toThrow(/Invalid JSON/);
  });
});
