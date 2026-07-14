import { describe, it, expect } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// The P23 firewall: dom.js must render every server/user string as inert text,
// never as parsed markup, and must neutralize javascript:/data: links.
function loadDom() {
  const dom = createDom();
  evalScript(dom, 'admin/dom.js');
  return dom;
}

describe('admin/dom.js — safe DOM (P23 firewall)', () => {
  it('renders a hostile string as text, not markup', () => {
    const dom = loadDom();
    const { h } = dom.window.ADMIN.dom;
    const payload = '<img src=x onerror=alert(1)>';
    const node = h('div', payload);
    // No element was injected — the whole thing is a single text node.
    expect(node.querySelector('img')).toBeNull();
    expect(node.children.length).toBe(0);
    expect(node.textContent).toBe(payload);
  });

  it('sets attributes via setAttribute (values are never parsed as HTML)', () => {
    const dom = loadDom();
    const { h } = dom.window.ADMIN.dom;
    const node = h('a', { href: '/x', 'data-id': 'a"b' }, 'link');
    expect(node.getAttribute('href')).toBe('/x');
    expect(node.getAttribute('data-id')).toBe('a"b');
    expect(node.textContent).toBe('link');
  });

  it('never registers on* handlers from attrs — behavior is caller-bound', () => {
    const dom = loadDom();
    const { h } = dom.window.ADMIN.dom;
    let clicked = 0;
    const btn = h('button', { type: 'button' }, 'go');
    btn.addEventListener('click', () => (clicked += 1));
    btn.click();
    expect(clicked).toBe(1);
    expect(btn.getAttribute('onclick')).toBeNull();
  });

  it('svg() builds SVG-namespaced nodes with text labels', () => {
    const dom = loadDom();
    const { svg } = dom.window.ADMIN.dom;
    const label = svg('text', { x: 1 }, 'Tool <b>name</b>');
    expect(label.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(label.querySelector('b')).toBeNull();
    expect(label.textContent).toBe('Tool <b>name</b>');
  });

  it('clear() empties a node', () => {
    const dom = loadDom();
    const { h, clear } = dom.window.ADMIN.dom;
    const box = h('div', [h('span', 'a'), h('span', 'b')]);
    expect(box.children.length).toBe(2);
    clear(box);
    expect(box.children.length).toBe(0);
  });

  describe('safeHref()', () => {
    const cases = [
      ['javascript:alert(1)', '#'],
      ['JAVASCRIPT:alert(1)', '#'],
      ['  javascript:alert(1)  ', '#'],
      ['data:text/html,<script>', '#'],
      ['vbscript:msgbox', '#'],
      ['', '#'],
    ];
    cases.forEach(([input, expected]) => {
      it(`neutralizes ${JSON.stringify(input)} → ${expected}`, () => {
        const dom = loadDom();
        expect(dom.window.ADMIN.dom.safeHref(input)).toBe(expected);
      });
    });

    it('allows http(s) and root-relative URLs', () => {
      const dom = loadDom();
      const { safeHref } = dom.window.ADMIN.dom;
      expect(safeHref('/tools')).toBe('/tools');
      expect(safeHref('https://example.com/x')).toBe('https://example.com/x');
      expect(safeHref('http://example.com/')).toBe('http://example.com/');
    });

    it('neutralizes a backslash-disguised offsite path (browsers fold \\ -> /)', () => {
      const dom = loadDom();
      const { safeHref } = dom.window.ADMIN.dom;
      // Prefix looks root-relative, but resolves to //evil.com (offsite).
      expect(safeHref('/\\evil.com')).toBe('#');
      expect(safeHref('/\\\\evil.com')).toBe('#');
      // A genuine same-origin path still passes.
      expect(safeHref('/convert/x/')).toBe('/convert/x/');
    });
  });
});
