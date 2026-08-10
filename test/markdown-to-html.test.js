import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('markdown-to-html.js — window.convertText', () => {
  it('converts headings and inline formatting', () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-html.js');

    const { text, filename } = dom.window.convertText('# Title\n\nHello **world** and *italic*');
    expect(filename).toBe('document.html');
    expect(text).toBe('<h1>Title</h1>\n<p>Hello <strong>world</strong> and <em>italic</em></p>');
  });

  it('converts unordered and ordered lists', () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-html.js');

    expect(dom.window.convertText('- one\n- two').text).toBe(
      '<ul>\n<li>one</li>\n<li>two</li>\n</ul>'
    );
    expect(dom.window.convertText('1. first\n2. second').text).toBe(
      '<ol>\n<li>first</li>\n<li>second</li>\n</ol>'
    );
  });

  it('preserves the language tag on fenced code blocks', () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-html.js');

    const { text } = dom.window.convertText('```js\nvar x = 1;\n```');
    expect(text).toBe('<pre><code class="language-js">var x = 1;</code></pre>');
  });

  it('converts links, blockquotes, and paragraphs', () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-html.js');

    expect(dom.window.convertText('[link](https://x.com)').text).toBe(
      '<p><a href="https://x.com">link</a></p>'
    );
    expect(dom.window.convertText('> quoted text').text).toBe(
      '<blockquote>\n<p>quoted text</p>\n</blockquote>'
    );
    expect(dom.window.convertText('para1\n\npara2').text).toBe('<p>para1</p>\n<p>para2</p>');
  });

  it('escapes HTML-significant characters in plain text', () => {
    const dom = createDom();
    evalScript(dom, 'converters/markdown-to-html.js');

    const { text } = dom.window.convertText('a < b & c > d');
    expect(text).toBe('<p>a &lt; b &amp; c &gt; d</p>');
  });
});
