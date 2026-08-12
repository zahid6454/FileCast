import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('json-diff.js — window.convertText', () => {
  it('reports no differences for structurally identical JSON, even with different key order', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-diff.js');

    const { text, filename } = dom.window.convertText('{"a":1,"b":2}', '{"b":2,"a":1}');

    expect(filename).toBe('diff.txt');
    expect(text).toContain('No differences');
  });

  it('reports a changed scalar value', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-diff.js');

    const { text } = dom.window.convertText('{"age":30}', '{"age":31}');

    expect(text).toContain('1 difference found');
    expect(text).toContain('~ $.age: 30 → 31');
  });

  it('reports an added and a removed key', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-diff.js');

    const { text } = dom.window.convertText('{"a":1,"b":2}', '{"a":1,"c":3}');

    expect(text).toContain('- $.b: 2 (removed)');
    expect(text).toContain('+ $.c: 3 (added)');
  });

  it('reports array differences by index, including added items', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-diff.js');

    const { text } = dom.window.convertText('{"list":[1,2]}', '{"list":[1,2,3]}');

    expect(text).toContain('+ $.list[2]: 3 (added)');
  });

  it('reports a type change between an object and a scalar', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-diff.js');

    const { text } = dom.window.convertText('{"a":{"b":1}}', '{"a":5}');

    expect(text).toContain('~ $.a: object(1 key) → 5');
  });

  it('walks nested paths correctly', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-diff.js');

    const { text } = dom.window.convertText(
      '{"user":{"address":{"city":"NYC"}}}',
      '{"user":{"address":{"city":"LA"}}}'
    );

    expect(text).toContain('~ $.user.address.city: "NYC" → "LA"');
  });

  it('detects a change on a key that shadows an Object.prototype member', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-diff.js');

    const { text } = dom.window.convertText('{"constructor":1}', '{"constructor":2}');
    expect(text).toContain('~ $.constructor: 1 → 2');
    expect(text).not.toContain('No differences');
  });

  it('detects an added key named like a common Object.prototype member', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-diff.js');

    const { text } = dom.window.convertText('{}', '{"hasOwnProperty":true,"toString":1}');
    expect(text).toContain('+ $.hasOwnProperty: true (added)');
    expect(text).toContain('+ $.toString: 1 (added)');
  });

  it('throws a descriptive error naming which side is invalid', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-diff.js');

    expect(() => dom.window.convertText('{bad', '{}')).toThrow(/Left JSON is invalid/);
    expect(() => dom.window.convertText('{}', '{bad')).toThrow(/Right JSON is invalid/);
  });
});
