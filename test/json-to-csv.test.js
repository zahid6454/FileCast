import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('json-to-csv.js — window.convertText', () => {
  it('converts an array of objects to a CSV with a union of headers', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-csv.js');

    const json = JSON.stringify([
      { name: 'Alice', age: 30 },
      { name: 'Bob', city: 'NYC' }
    ]);
    const { text, filename } = dom.window.convertText(json);
    const lines = text.split('\n');

    expect(filename).toBe('data.csv');
    expect(lines[0]).toBe('name,age,city');
    expect(lines[1]).toBe('Alice,30,');
    expect(lines[2]).toBe('Bob,,NYC');
  });

  it('wraps a single object in an array', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-csv.js');

    const { text } = dom.window.convertText(JSON.stringify({ a: 1, b: 2 }));
    expect(text).toBe('a,b\n1,2');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-csv.js');

    const json = JSON.stringify([{ note: 'a, "quoted" line\nsecond line' }]);
    const { text } = dom.window.convertText(json);
    const lines = text.split('\n');

    expect(lines[1]).toBe('"a, ""quoted"" line');
    expect(lines[2]).toBe('second line"');
  });

  it('throws on an empty array', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-csv.js');
    expect(() => dom.window.convertText('[]')).toThrow(/empty/i);
  });

  it('throws on a non-object, non-array JSON value', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-csv.js');
    expect(() => dom.window.convertText('42')).toThrow(/array of objects/i);
  });
});
