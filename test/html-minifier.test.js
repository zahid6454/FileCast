import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('html-minifier.js — window.convertText', () => {
  it('strips comments and collapses whitespace between tags', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-minifier.js');

    const { text, filename } = dom.window.convertText(
      '<div>\n  <p>Hello</p>\n  <!-- a comment -->\n  <span>World</span>\n</div>'
    );

    expect(filename).toBe('minified.html');
    expect(text).toBe('<div><p>Hello</p><span>World</span></div>');
  });

  it('preserves whitespace inside <pre> exactly (surrounding whitespace collapses to a single space, not zero, since a protected block might sit next to significant inline content)', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-minifier.js');

    const input = '<div>\n  <pre>  line one\n  line two  </pre>\n</div>';
    const { text } = dom.window.convertText(input);

    expect(text).toBe('<div> <pre>  line one\n  line two  </pre> </div>');
  });

  it('does not touch // comments or whitespace inside <script>', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-minifier.js');

    const input = '<div>\n  <script>\n    // keep me\n    var a = 1;\n  </script>\n</div>';
    const { text } = dom.window.convertText(input);

    expect(text).toContain('// keep me\n    var a = 1;');
  });

  it('restores a protected block correctly even when it is the entire input', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-minifier.js');

    const { text } = dom.window.convertText('<pre>  keep  this  </pre>');

    expect(text).toBe('<pre>  keep  this  </pre>');
  });
});
