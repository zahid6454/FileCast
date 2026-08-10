import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// O4 audit item #9: `!isNaN(str)` accepted "00501" (a zip code) and the
// literal string "Infinity", silently corrupting both on the way to JSON.

describe('xml-to-json.js — window.convertText', () => {
  it('preserves leading zeros instead of coercing them to a number', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-to-json.js');

    const xml = '<root><zip>00501</zip></root>';
    const { text } = dom.window.convertText(xml);
    const data = JSON.parse(text);

    expect(data.root.zip).toBe('00501');
  });

  it('keeps the literal string "Infinity" as a string, not JS Infinity', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-to-json.js');

    const xml = '<root><note>Infinity</note></root>';
    const { text } = dom.window.convertText(xml);
    const data = JSON.parse(text);

    expect(data.root.note).toBe('Infinity');
  });

  it('still converts ordinary numeric text nodes to numbers', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-to-json.js');

    const xml = '<root><count>42</count><price>-3.5</price></root>';
    const { text } = dom.window.convertText(xml);
    const data = JSON.parse(text);

    expect(data.root.count).toBe(42);
    expect(data.root.price).toBe(-3.5);
  });
});
