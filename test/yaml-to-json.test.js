import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// O4 audit item #9: `!isNaN(str)` accepted "00501" (a zip code) and the
// literal string "Infinity", silently corrupting both on the way to JSON.

describe('yaml-to-json.js — window.convertText', () => {
  it('preserves leading zeros instead of coercing them to a number', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-json.js');

    const yaml = 'zip: 00501\n';
    const { text } = dom.window.convertText(yaml);
    const data = JSON.parse(text);

    expect(data.zip).toBe('00501');
  });

  it('keeps the literal string Infinity as a string, not JS Infinity', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-json.js');

    const yaml = 'note: Infinity\n';
    const { text } = dom.window.convertText(yaml);
    const data = JSON.parse(text);

    expect(data.note).toBe('Infinity');
  });

  it('still converts ordinary numeric scalars to numbers', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-json.js');

    const yaml = 'count: 42\nprice: -3.5\n';
    const { text } = dom.window.convertText(yaml);
    const data = JSON.parse(text);

    expect(data.count).toBe(42);
    expect(data.price).toBe(-3.5);
  });

  it('keeps a bare list-item scalar containing a colon as a string, not a nested object', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-json.js');

    const yaml = 'urls:\n  - http://example.com\n  - https://test.org\n';
    const { text } = dom.window.convertText(yaml);
    const data = JSON.parse(text);

    expect(data.urls).toEqual(['http://example.com', 'https://test.org']);
  });

  it('still parses a compact inline mapping list item ("- key: value")', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-json.js');

    const yaml = 'people:\n  - name: Alice\n    age: 30\n';
    const { text } = dom.window.convertText(yaml);
    const data = JSON.parse(text);

    expect(data.people).toEqual([{ name: 'Alice', age: 30 }]);
  });
});
