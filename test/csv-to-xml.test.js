import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('csv-to-xml.js — window.convertText', () => {
  it('converts a simple CSV into row elements', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-xml.js');

    const csv = 'name,age\nAlice,30\nBob,25\n';
    const { text, filename } = dom.window.convertText(csv);

    expect(filename).toBe('data.xml');
    expect(text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(text).toContain('<rows>');
    expect(text).toContain('<row>\n    <name>Alice</name>\n    <age>30</age>\n  </row>');
    expect(text).toContain('<row>\n    <name>Bob</name>\n    <age>25</age>\n  </row>');
  });

  it('sanitizes headers that are not valid XML tag names', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-xml.js');

    const csv = 'first name,2nd col\nAlice,x\n';
    const { text } = dom.window.convertText(csv);

    expect(text).toContain('<first_name>Alice</first_name>');
    expect(text).toContain('<_2nd_col>x</_2nd_col>');
  });

  it('escapes special XML characters in values', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-xml.js');

    const csv = 'note\n"Tom & Jerry <3"\n';
    const { text } = dom.window.convertText(csv);

    expect(text).toContain('<note>Tom &amp; Jerry &lt;3</note>');
  });

  it('handles quoted fields containing commas and escaped quotes', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-xml.js');

    const csv = 'name,quote\n"Doe, John","She said ""hi"""\n';
    const { text } = dom.window.convertText(csv);

    expect(text).toContain('<name>Doe, John</name>');
    expect(text).toContain('<quote>She said &quot;hi&quot;</quote>');
  });

  it('throws when the CSV has no data rows', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-xml.js');

    expect(() => dom.window.convertText('name,age\n')).toThrow(/header row and one data row/);
  });
});
