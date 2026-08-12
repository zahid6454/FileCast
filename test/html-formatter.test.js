import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('html-formatter.js — window.convertText', () => {
  it('indents minified HTML', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-formatter.js');

    const { text, filename } = dom.window.convertText('<div><p>Hello</p><span>World</span></div>');

    expect(filename).toBe('formatted.html');
    expect(text).toBe('<div>\n  <p>Hello</p>\n  <span>World</span>\n</div>');
  });

  it('does not indent past a void element like <br> or <img>', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-formatter.js');

    const { text } = dom.window.convertText('<div><br><img src="x.png"><p>next</p></div>');

    expect(text).toBe('<div>\n  <br>\n  <img src="x.png">\n  <p>next</p>\n</div>');
  });

  it('preserves DOCTYPE on its own line', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-formatter.js');

    const { text } = dom.window.convertText('<!DOCTYPE html><html><body>x</body></html>');

    expect(text.split('\n')[0]).toBe('<!DOCTYPE html>');
  });

  it('does not throw on malformed HTML (HTML5 parsing is lenient by design)', () => {
    const dom = createDom();
    evalScript(dom, 'converters/html-formatter.js');

    expect(() => dom.window.convertText('<div><p>unclosed')).not.toThrow();
  });
});
