import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('tsv-to-csv.js — window.convertText', () => {
  it('converts tab-delimited rows into comma-delimited CSV', () => {
    const dom = createDom();
    evalScript(dom, 'converters/tsv-to-csv.js');

    const tsv = 'name\tage\nAlice\t30\nBob\t25\n';
    const { text, filename } = dom.window.convertText(tsv);

    expect(filename).toBe('data.csv');
    expect(text).toBe('name,age\r\nAlice,30\r\nBob,25');
  });

  it('quotes a value that contains a comma', () => {
    const dom = createDom();
    evalScript(dom, 'converters/tsv-to-csv.js');

    const tsv = 'name\tcity\nAlice\tParis, France\n';
    const { text } = dom.window.convertText(tsv);

    expect(text).toContain('"Paris, France"');
  });

  it('handles quoted TSV fields containing tabs and doubled quotes', () => {
    const dom = createDom();
    evalScript(dom, 'converters/tsv-to-csv.js');

    const tsv = 'note\n"tab\there"\t"She said ""hi"""\n';
    const { text } = dom.window.convertText(tsv);

    // The quoted tab is correctly treated as literal field content, not a
    // delimiter, so this parses as two fields, not three. A bare tab needs
    // no CSV quoting (only comma/quote/newline do), so it comes through as-is.
    expect(text).toContain('tab\there,"She said ""hi"""');
  });

  it('throws on completely empty input', () => {
    const dom = createDom();
    evalScript(dom, 'converters/tsv-to-csv.js');

    expect(() => dom.window.convertText('   \n  \n')).toThrow(/at least one row/);
  });
});
