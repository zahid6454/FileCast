import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('yaml-to-xml.js — window.convertText', () => {
  it('converts a simple YAML mapping to XML', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-xml.js');

    const yamlText = 'name: Alice\nage: 30\n';
    const { text, filename } = dom.window.convertText(yamlText);

    expect(filename).toBe('data.xml');
    expect(text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(text).toContain('<name>Alice</name>');
    expect(text).toContain('<age>30</age>');
  });

  it('converts a YAML list into repeated item elements', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-xml.js');

    const yamlText = 'colors:\n  - red\n  - green\n  - blue\n';
    const { text } = dom.window.convertText(yamlText);

    expect(text).toContain('<colors>');
    const itemCount = (text.match(/<item>/g) || []).length;
    expect(itemCount).toBe(3);
    expect(text).toContain('<item>red</item>');
  });

  it('sanitizes keys that are not valid XML tag names', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-xml.js');

    const yamlText = '"first name": Alice\n';
    const { text } = dom.window.convertText(yamlText);

    expect(text).toContain('<first_name>Alice</first_name>');
  });

  it('escapes special XML characters', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-xml.js');

    const yamlText = 'note: "Tom & Jerry <3"\n';
    const { text } = dom.window.convertText(yamlText);

    expect(text).toContain('<note>Tom &amp; Jerry &lt;3</note>');
  });

  it('keeps a bare list-item scalar containing a colon as a string, not a nested mapping', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-xml.js');

    const yamlText = 'urls:\n  - http://example.com\n  - https://test.org\n';
    const { text } = dom.window.convertText(yamlText);

    expect(text).toContain('<item>http://example.com</item>');
    expect(text).toContain('<item>https://test.org</item>');
    expect(text).not.toContain('<http>');
  });

  it('still parses a compact inline mapping list item ("- key: value")', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-xml.js');

    const yamlText = 'people:\n  - name: Alice\n    age: 30\n';
    const { text } = dom.window.convertText(yamlText);

    expect(text).toContain('<name>Alice</name>');
    expect(text).toContain('<age>30</age>');
  });

  it('throws when the top-level YAML value is a bare scalar', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-to-xml.js');

    expect(() => dom.window.convertText('just a string')).toThrow(/mapping or list/);
  });
});
