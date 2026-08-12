import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('xml-formatter.js — window.convertText', () => {
  it('indents a minified, single-line XML document', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-formatter.js');

    const { text, filename } = dom.window.convertText(
      '<root><name>Alice</name><age>30</age></root>'
    );

    expect(filename).toBe('formatted.xml');
    expect(text).toBe('<root>\n  <name>Alice</name>\n  <age>30</age>\n</root>');
  });

  it('keeps a self-closing tag on one line without indenting deeper', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-formatter.js');

    const { text } = dom.window.convertText('<root><empty/><next>x</next></root>');

    expect(text).toBe('<root>\n  <empty/>\n  <next>x</next>\n</root>');
  });

  it('preserves the XML declaration on its own line', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-formatter.js');

    const { text } = dom.window.convertText(
      '<?xml version="1.0" encoding="UTF-8"?><root><a>1</a></root>'
    );

    expect(text.split('\n')[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it('throws a descriptive error for malformed XML', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-formatter.js');

    expect(() => dom.window.convertText('<root><a>1</b></root>')).toThrow(/Invalid XML/);
  });

  it('throws on more than one root element', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-formatter.js');

    expect(() => dom.window.convertText('<a>1</a><b>2</b>')).toThrow(/more than one root element/);
  });

  it('throws on an unescaped ampersand in text content', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-formatter.js');

    expect(() => dom.window.convertText('<note>Tom & Jerry</note>')).toThrow(/unescaped "&"/);
  });

  // This is the actual bug this rewrite fixes: DOMParser is a Window-only
  // API and this converter runs inside a Worker (via text-converter-worker.js
  // in production), where DOMParser is undefined.
  it('does not reference DOMParser at all', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-formatter.js');
    dom.window.DOMParser = undefined;

    expect(() => dom.window.convertText('<root><a>1</a></root>')).not.toThrow();
  });
});
