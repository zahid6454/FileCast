import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// O4 audit item #9: `!isNaN(val)` accepted "00501" (a zip code) and the
// literal string "Infinity", silently corrupting both on the way to JSON.

describe('csv-to-json.js — window.convertText', () => {
  it('preserves leading zeros instead of coercing them to a number', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-json.js');

    const csv = 'zip,phone\n00501,0123456789\n';
    const { text } = dom.window.convertText(csv);
    const data = JSON.parse(text);

    expect(data[0].zip).toBe('00501');
    expect(data[0].phone).toBe('0123456789');
  });

  it('keeps the literal string "Infinity" as a string, not JS Infinity', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-json.js');

    const csv = 'note\nInfinity\n';
    const { text } = dom.window.convertText(csv);
    const data = JSON.parse(text);

    expect(data[0].note).toBe('Infinity');
  });

  it('still converts ordinary numeric strings to numbers', () => {
    const dom = createDom();
    evalScript(dom, 'converters/csv-to-json.js');

    const csv = 'count,price\n42,-3.5\n';
    const { text } = dom.window.convertText(csv);
    const data = JSON.parse(text);

    expect(data[0].count).toBe(42);
    expect(data[0].price).toBe(-3.5);
  });
});
