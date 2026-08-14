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

  it('decodes a numeric entity exactly once, not re-scanning its own output for a further entity (matches a real HTML parser)', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    // &#38; decodes to "&"; the tool must NOT then treat the following
    // "amp;" as a second entity to decode — a real browser parses this to
    // the literal text "&amp;", not a bare "&".
    const { text } = dom.window.convertText('&#38;amp;');

    expect(text).toBe('&amp;');
  });

  it('strips HTML comments', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text } = dom.window.convertText('<p>Before<!-- a comment -->After</p>');

    expect(text).toBe('BeforeAfter');
  });

  it('strips a tag whose quoted attribute value contains a literal ">"', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text } = dom.window.convertText('<a title="a > b">Click here</a>');

    expect(text).toBe('Click here');
  });

  it('strips a tag with a single-quoted attribute value containing ">"', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text } = dom.window.convertText("<div data-x='1 > 0'>Content</div>");

    expect(text).toBe('Content');
  });

  it('drops an unterminated tag at end of input instead of leaking it as text', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text } = dom.window.convertText('<p>Unterminated <div');

    expect(text).toBe('Unterminated');
  });

  it('collapses excessive blank lines', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-to-text.js');

    const { text } = dom.window.convertText('<p>A</p><p></p><p></p><p>B</p>');

    expect(text).toBe('A\n\nB');
  });
});
