import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('xml-validator.js — window.convertText', () => {
  it('confirms well-formed XML and returns it formatted', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-validator.js');

    const { text, filename } = dom.window.convertText('<root><name>Alice</name></root>');

    expect(filename).toBe('validated.xml');
    expect(text.split('\n')[0]).toBe('<!-- ✓ Valid XML -->');
    expect(text).toContain('<name>Alice</name>');
  });

  it('inserts the validity comment AFTER the XML declaration, not before it', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-validator.js');

    const { text } = dom.window.convertText(
      '<?xml version="1.0" encoding="UTF-8"?><root><a>1</a></root>'
    );
    const lines = text.split('\n');

    expect(lines[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(lines[1]).toBe('<!-- ✓ Valid XML -->');
  });

  it('throws a descriptive error for malformed XML', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-validator.js');

    expect(() => dom.window.convertText('<root><a>1</a>')).toThrow(/Invalid XML/);
  });

  it('throws on mismatched tags', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-validator.js');

    expect(() => dom.window.convertText('<root><a>1</b></root>')).toThrow(/Invalid XML/);
  });

  it('throws on more than one root element', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-validator.js');

    expect(() => dom.window.convertText('<a>1</a><b>2</b>')).toThrow(/more than one root element/);
  });

  it('throws on an unescaped ampersand in text content', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-validator.js');

    expect(() => dom.window.convertText('<note>Tom & Jerry</note>')).toThrow(/unescaped "&"/);
  });

  it('accepts a properly escaped ampersand', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-validator.js');

    expect(() => dom.window.convertText('<note>Tom &amp; Jerry</note>')).not.toThrow();
  });

  it('accepts self-closing tags without treating them as a second root', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-validator.js');

    expect(() => dom.window.convertText('<root><a/><b/></root>')).not.toThrow();
  });

  it('does not misread markup-like text inside a comment as real tags', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-validator.js');

    expect(() =>
      dom.window.convertText('<root><!-- <fake></fake> --><a>1</a></root>')
    ).not.toThrow();
  });

  // This is the actual bug this rewrite fixes: DOMParser is a Window-only
  // API and this converter runs inside a Worker (via text-converter-worker.js
  // in production), where DOMParser is undefined — using it would throw
  // "DOMParser is not defined" for every input, valid or not.
  it('does not reference DOMParser at all', () => {
    const dom = createDom();
    evalScript(dom, 'converters/xml-validator.js');
    dom.window.DOMParser = undefined;

    expect(() => dom.window.convertText('<root><a>1</a></root>')).not.toThrow();
  });
});
