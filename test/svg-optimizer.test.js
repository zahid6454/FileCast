import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('svg-optimizer.js — window.convertFile', () => {
  it('strips comments, empty metadata, editor attributes, and insignificant whitespace', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/svg-optimizer.js');

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd" width="100" height="100">
  <!-- exported by Editor 1.0 -->
  <metadata>
    <dc-description>lots of editor bookkeeping</dc-description>
  </metadata>
  <title></title>
  <sodipodi:namedview id="base" pagecolor="#ffffff"></sodipodi:namedview>
  <rect inkscape:label="Rectangle" x="10" y="10" width="80" height="80" fill="#ff0000"></rect>
</svg>`;

    const file = new dom.window.File([svg], 'icon.svg', { type: 'image/svg+xml' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/svg+xml');
    const output = await blob.text();

    expect(output).not.toContain('exported by Editor');
    expect(output).not.toContain('rdf:RDF');
    expect(output).not.toContain('lots of editor bookkeeping');
    expect(output).not.toContain('sodipodi');
    expect(output).not.toContain('inkscape');
    expect(output).not.toContain('<title');
    expect(output).toContain('<rect');
    expect(output).toContain('fill="#ff0000"');
    expect(output.length).toBeLessThan(svg.length);
  });

  it('preserves whitespace inside a <text> element', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/svg-optimizer.js');

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="10">Hello   World</text></svg>';
    const file = new dom.window.File([svg], 'label.svg', { type: 'image/svg+xml' });
    const blob = await dom.window.convertFile(file);
    const output = await blob.text();

    expect(output).toContain('Hello   World');
  });

  it('returns the original bytes unchanged when there is nothing to optimize', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/svg-optimizer.js');

    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const file = new dom.window.File([svg], 'tiny.svg', { type: 'image/svg+xml' });
    const blob = await dom.window.convertFile(file);
    const output = await blob.text();

    expect(output).toBe(svg);
  });

  it('rejects a file with no <svg> root element', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/svg-optimizer.js');

    const file = new dom.window.File(['<not-svg></not-svg>'], 'bad.svg', { type: 'image/svg+xml' });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/svg.*root element/i);
  });
});
