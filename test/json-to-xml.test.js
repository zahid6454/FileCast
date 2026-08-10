import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('json-to-xml.js — window.convertText', () => {
  it('converts a nested object to XML under a <root> element', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-xml.js');

    const { text, filename } = dom.window.convertText(
      JSON.stringify({ name: 'Alice', age: 30, active: true })
    );

    expect(filename).toBe('data.xml');
    expect(text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(text).toContain('<root>');
    expect(text).toContain('<name>Alice</name>');
    expect(text).toContain('<age>30</age>');
    expect(text).toContain('<active>true</active>');
  });

  it('renders array items as repeated <item> elements', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-xml.js');

    const { text } = dom.window.convertText(JSON.stringify({ tags: ['a', 'b'] }));
    expect(text).toContain('<tags>');
    expect(text.match(/<item>/g)).toHaveLength(2);
    expect(text).toContain('<item>a</item>');
    expect(text).toContain('<item>b</item>');
  });

  it('escapes reserved XML characters in text content', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-xml.js');

    const { text } = dom.window.convertText(JSON.stringify({ note: '<a> & "b" \'c\'' }));
    expect(text).toContain('&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;');
  });

  it('sanitizes keys that are not valid XML tag names', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-xml.js');

    const { text } = dom.window.convertText(JSON.stringify({ '2fast': 1, 'weird key!': 2 }));
    expect(text).toContain('<_2fast>1</_2fast>');
    expect(text).toContain('<weird_key_>2</weird_key_>');
  });

  it('renders null as a self-closing tag', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-xml.js');

    const { text } = dom.window.convertText(JSON.stringify({ empty: null }));
    expect(text).toContain('<empty/>');
  });
});
