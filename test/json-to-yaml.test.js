import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('json-to-yaml.js — window.convertText', () => {
  it('converts a flat object to key: value lines', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-yaml.js');

    const { text, filename } = dom.window.convertText(
      JSON.stringify({ name: 'Alice', age: 30, active: true })
    );

    expect(filename).toBe('data.yaml');
    expect(text).toContain('name: Alice');
    expect(text).toContain('age: 30');
    expect(text).toContain('active: true');
  });

  it('quotes a number-looking string so it round-trips as a string', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-yaml.js');

    // This is the fix from O4 audit item #9's counterpart bug: json-to-yaml.js
    // already guards this correctly — a zip code like "00501" must not come
    // back out as a bare, YAML-parses-as-number token.
    const { text } = dom.window.convertText(JSON.stringify({ zip: '00501' }));
    expect(text).toContain('zip: "00501"');
  });

  it('quotes reserved-word-looking strings (true/false/null)', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-yaml.js');

    const { text } = dom.window.convertText(JSON.stringify({ flag: 'true' }));
    expect(text).toContain('flag: "true"');
  });

  it('quotes keys containing a colon or space', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-yaml.js');

    const { text } = dom.window.convertText(JSON.stringify({ 'a: b': 1 }));
    expect(text).toContain('"a: b": 1');
  });

  it('renders an array of scalars as a dashed list', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-yaml.js');

    const { text } = dom.window.convertText(JSON.stringify({ tags: ['a', 'b'] }));
    expect(text).toContain('tags: - a\n  - b');
  });

  it('renders an empty array/object as [] / {}', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-yaml.js');

    const { text } = dom.window.convertText(JSON.stringify({ list: [], obj: {} }));
    expect(text).toContain('list: []');
    expect(text).toContain('obj: {}');
  });
});
