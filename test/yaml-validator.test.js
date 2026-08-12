import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

describe('yaml-validator.js — window.convertText', () => {
  it('confirms valid YAML and normalizes it', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    const { text, filename } = dom.window.convertText('name: Alice\nage: 30\nactive: true');

    expect(filename).toBe('validated.yaml');
    expect(text).toMatch(/^# ✓ Valid YAML/);
    expect(text).toContain('name: Alice');
    expect(text).toContain('age: 30');
    expect(text).toContain('active: true');
  });

  it('handles nested mappings and sequences', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    const yaml = 'user:\n  name: Bob\n  tags:\n    - admin\n    - active\n';
    const { text } = dom.window.convertText(yaml);

    expect(text).toContain('user:');
    expect(text).toContain('name: Bob');
    expect(text).toContain('- admin');
    expect(text).toContain('- active');
  });

  it('handles a sequence of mappings', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    const yaml = 'people:\n  - name: Alice\n    age: 30\n  - name: Bob\n    age: 25\n';
    const { text } = dom.window.convertText(yaml);

    expect(text).toContain('- name: Alice');
    expect(text).toContain('age: 30');
    expect(text).toContain('- name: Bob');
  });

  it('rejects tab-indented YAML', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    expect(() => dom.window.convertText('name: Alice\n\tage: 30')).toThrow(
      /tab character used for indentation on line 2/
    );
  });

  it('rejects duplicate keys at the same level', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    expect(() => dom.window.convertText('name: Alice\nname: Bob')).toThrow(
      /duplicate key "name" on line 2/
    );
  });

  it('rejects inconsistent sibling indentation', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    const yaml = 'user:\n  name: Bob\n   age: 30\n';
    expect(() => dom.window.convertText(yaml)).toThrow(/inconsistent indentation on line 3/);
  });

  it('does not misread a URL or a bare time as a mapping key', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    const { text } = dom.window.convertText('homepage: http://example.com');
    expect(text).toContain('homepage:');
    expect(text).toMatch(/http:\/\/example\.com/);
  });

  it('preserves a leading-zero string like a zip code', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    const { text } = dom.window.convertText('zip: "00501"');
    expect(text).toContain('zip: "00501"');
  });

  it('parses flow-style arrays and objects', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    const { text } = dom.window.convertText('tags: [a, b, c]');
    expect(text).toContain('- a');
    expect(text).toContain('- b');
  });

  it('rejects a malformed flow collection', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    expect(() => dom.window.convertText('tags: [a, b')).toThrow(/malformed flow collection/);
  });

  it('handles an empty document', () => {
    const dom = createDom();
    evalScript(dom, 'converters/yaml-validator.js');

    const { text } = dom.window.convertText('');
    expect(text).toContain('null');
  });
});
