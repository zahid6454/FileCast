import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('xml-to-yaml.js — window.convertText', () => {
  it('converts a simple XML document to YAML', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-to-yaml.js');

    const xml = '<root><name>Alice</name><age>30</age></root>';
    const { text, filename } = dom.window.convertText(xml);

    expect(filename).toBe('data.yaml');
    expect(text).toContain('root:');
    expect(text).toContain('name: Alice');
    expect(text).toContain('age: 30');
  });

  it('preserves attributes with an @ prefix', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-to-yaml.js');

    const xml = '<root><user id="42">Alice</user></root>';
    const { text } = dom.window.convertText(xml);

    expect(text).toContain('@id: "42"');
  });

  it('converts repeated sibling elements into a list', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-to-yaml.js');

    const xml = '<root><item>1</item><item>2</item><item>3</item></root>';
    const { text } = dom.window.convertText(xml);

    expect(text).toMatch(/item:\n(\s*- 1\n\s*- 2\n\s*- 3)/);
  });

  it('throws a clear error on malformed XML', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-to-yaml.js');

    expect(() => dom.window.convertText('<root><unclosed></root>')).toThrow(/Invalid XML/);
  });
});
