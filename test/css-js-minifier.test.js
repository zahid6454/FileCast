import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('css-js-minifier.js — window.convertText', () => {
  it('detects and minifies CSS', () => {
    const dom = createDom();
    evalScript(dom, 'converters/css-js-minifier.js');

    const { text, filename } = dom.window.convertText(
      '.button {\n  color: blue;\n  padding: 4px 8px;\n}\n'
    );

    expect(filename).toBe('styles.min.css');
    expect(text).toBe('.button{color:blue;padding:4px 8px;}');
  });

  it('strips CSS comments', () => {
    const dom = createDom();
    evalScript(dom, 'converters/css-js-minifier.js');

    const { text } = dom.window.convertText('/* header */\n.a { color: red; }');
    expect(text).not.toContain('/*');
    expect(text).toContain('color:red');
  });

  it('preserves a string value in CSS content/url()', () => {
    const dom = createDom();
    evalScript(dom, 'converters/css-js-minifier.js');

    const { text } = dom.window.convertText('.a::before { content: "a  ,  b"; }');
    expect(text).toContain('content:"a  ,  b"');
  });

  it('detects and minifies JS, stripping comments', () => {
    const dom = createDom();
    evalScript(dom, 'converters/css-js-minifier.js');

    const input = 'function add(a, b) {\n  // sum two numbers\n  return a + b;\n}\n';
    const { text, filename } = dom.window.convertText(input);

    expect(filename).toBe('script.min.js');
    expect(text).not.toContain('//');
    expect(text).toContain('function add(a, b)');
    expect(text).toContain('return a + b;');
  });

  it('does not corrupt a regex literal containing //', () => {
    const dom = createDom();
    evalScript(dom, 'converters/css-js-minifier.js');

    const input = 'var re = /^https?:\\/\\//;\nvar x = 1;';
    const { text } = dom.window.convertText(input);

    expect(text).toContain('/^https?:\\/\\//');
    expect(text).toContain('var x = 1;');
  });

  it('does not touch string contents that look like comments', () => {
    const dom = createDom();
    evalScript(dom, 'converters/css-js-minifier.js');

    const input = 'var msg = "not // a comment";\nconsole.log(msg);';
    const { text } = dom.window.convertText(input);

    expect(text).toContain('"not // a comment"');
  });

  it('preserves division correctly (does not treat / as a regex start after an identifier)', () => {
    const dom = createDom();
    evalScript(dom, 'converters/css-js-minifier.js');

    const input = 'var a = 10;\nvar b = a / 2 / 5;\nconsole.log(b);';
    const { text } = dom.window.convertText(input);

    expect(text).toContain('a / 2 / 5');
  });

  it('does not rename variables or otherwise change JS logic', () => {
    const dom = createDom();
    evalScript(dom, 'converters/css-js-minifier.js');

    const input = 'function greet(name) {\n  return "Hello, " + name;\n}';
    const { text } = dom.window.convertText(input);

    expect(text).toContain('function greet(name)');
    expect(text).toContain('"Hello, " + name');
  });
});
