import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('html-to-markdown.js — window.convertText', () => {
  it('converts headings and inline formatting', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-markdown.js');

    const { text, filename } = dom.window.convertText(
      '<h1>Title</h1><p>Hello <strong>world</strong> and <em>italic</em></p>'
    );
    expect(filename).toBe('document.md');
    expect(text).toBe('# Title\n\nHello **world** and *italic*');
  });

  it('converts unordered and ordered lists', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-markdown.js');

    expect(dom.window.convertText('<ul><li>one</li><li>two</li></ul>').text).toBe('- one\n- two');
    expect(dom.window.convertText('<ol><li>first</li><li>second</li></ol>').text).toBe(
      '1. first\n2. second'
    );
  });

  it('preserves the language tag on fenced code blocks', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-markdown.js');

    const { text } = dom.window.convertText(
      '<pre><code class="language-js">var x = 1;</code></pre>'
    );
    expect(text).toBe('```js\nvar x = 1;\n```');
  });

  it('converts links, blockquotes, and tables', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-markdown.js');

    expect(dom.window.convertText('<a href="https://x.com">link</a>').text).toBe(
      '[link](https://x.com)'
    );
    expect(dom.window.convertText('<blockquote>quoted text</blockquote>').text).toBe(
      '> quoted text'
    );
    expect(
      dom.window.convertText(
        '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
      ).text
    ).toBe('| A | B |\n|---|---|\n| 1 | 2 |');
  });
});
