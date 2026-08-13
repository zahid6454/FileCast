import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('html-to-text.js — window.convertText', () => {
  it('strips tags and keeps visible text', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text, filename } = dom.window.convertText(
      '<h1>Hello</h1><p>This is <strong>bold</strong> text.</p>'
    );

    expect(filename).toBe('stripped.txt');
    expect(text).toBe('Hello\nThis is bold text.');
  });

  it('removes script and style content entirely', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text } = dom.window.convertText(
      '<style>.a{color:red}</style><p>Visible</p><script>alert("hi")</script>'
    );

    expect(text).toBe('Visible');
  });

  it('converts <br> and block closes into line breaks', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text } = dom.window.convertText('Line one<br>Line two<br/>Line three');

    expect(text).toBe('Line one\nLine two\nLine three');
  });

  it('decodes named and numeric HTML entities', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text } = dom.window.convertText('Tom &amp; Jerry &mdash; caf&#233; &#x2764;');

    expect(text).toBe('Tom & Jerry — café ❤');
  });

  it('strips HTML comments', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text } = dom.window.convertText('<p>Before<!-- a comment -->After</p>');

    expect(text).toBe('BeforeAfter');
  });

  it('collapses excessive blank lines', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text } = dom.window.convertText('<p>A</p><p></p><p></p><p>B</p>');

    expect(text).toBe('A\n\nB');
  });
});
