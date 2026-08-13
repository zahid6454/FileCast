import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('json-to-typescript.js — window.convertText', () => {
  it('generates an interface with primitive fields', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-typescript.js');

    const { text, filename } = dom.window.convertText('{"name":"Alice","age":30,"active":true}');

    expect(filename).toBe('interfaces.ts');
    expect(text).toContain('interface RootObject {');
    expect(text).toContain('name: string;');
    expect(text).toContain('age: number;');
    expect(text).toContain('active: boolean;');
  });

  it('splits a nested object into its own named interface', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-typescript.js');

    const { text } = dom.window.convertText(
      '{"name":"Alice","address":{"city":"NYC","zip":"10001"}}'
    );

    expect(text).toContain('address: Address;');
    expect(text).toContain('interface Address {');
    expect(text).toContain('city: string;');
    expect(text).toContain('zip: string;');
  });

  it('types an array of primitives as an array type', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-typescript.js');

    const { text } = dom.window.convertText('{"tags":["a","b","c"]}');

    expect(text).toContain('tags: string[];');
  });

  it('generates a type alias plus item interface for a root array of objects', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-typescript.js');

    const { text } = dom.window.convertText('[{"id":1,"name":"a"},{"id":2,"name":"b"}]');

    expect(text).toContain('type RootObject = RootObjectItem[];');
    expect(text).toContain('interface RootObjectItem {');
    expect(text).toContain('id: number;');
  });

  it('generates a type alias for a root primitive', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-typescript.js');

    const { text } = dom.window.convertText('42');

    expect(text.trim()).toBe('type RootObject = number;');
  });

  it('quotes property keys that are not valid TypeScript identifiers', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-typescript.js');

    const { text } = dom.window.convertText('{"invalid-key":1,"valid_key":2}');

    expect(text).toContain('"invalid-key": number;');
    expect(text).toContain('valid_key: number;');
  });

  it('disambiguates two nested objects that would generate the same interface name', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-typescript.js');

    const { text } = dom.window.convertText('{"home-page":{"city":"A"},"homePage":{"city":"B"}}');

    const interfaceCount = (text.match(/^interface /gm) || []).length;
    expect(interfaceCount).toBe(3); // RootObject + two distinctly-named nested interfaces
  });

  it('throws a descriptive error for invalid JSON', () => {
    const dom = createDom();
    evalScript(dom, 'converters/json-to-typescript.js');

    expect(() => dom.window.convertText('{not valid json')).toThrow(/Invalid JSON/);
  });
});
