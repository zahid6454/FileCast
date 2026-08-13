import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// header: {"alg":"HS256","typ":"JWT"}, payload: {"sub":"1234567890","name":"John Doe","iat":1516239022}
const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('jwt-decoder.js — window.convertText', () => {
  it('decodes the header and payload of a valid JWT', () => {
    const dom = createDom();
    evalScript(dom, 'converters/jwt-decoder.js');

    const { text, filename } = dom.window.convertText(SAMPLE_JWT);

    expect(filename).toBe('jwt-decoded.txt');
    expect(text).toContain('"alg": "HS256"');
    expect(text).toContain('"typ": "JWT"');
    expect(text).toContain('"sub": "1234567890"');
    expect(text).toContain('"name": "John Doe"');
    expect(text).toContain('"iat": 1516239022');
  });

  it('includes an explicit not-verified warning near the signature', () => {
    const dom = createDom();
    evalScript(dom, 'converters/jwt-decoder.js');

    const { text } = dom.window.convertText(SAMPLE_JWT);

    expect(text).toMatch(/NOT verified/);
  });

  it('handles base64url characters (- and _) not present in standard base64', () => {
    const dom = createDom();
    evalScript(dom, 'converters/jwt-decoder.js');

    // Signature segment of the sample token contains a literal "_".
    expect(() => dom.window.convertText(SAMPLE_JWT)).not.toThrow();
  });

  it('throws a descriptive error when the token does not have 3 parts', () => {
    const dom = createDom();
    evalScript(dom, 'converters/jwt-decoder.js');

    expect(() => dom.window.convertText('not.a.jwt.token')).toThrow(/found 4/);
    expect(() => dom.window.convertText('onlyonepart')).toThrow(/found 1/);
  });

  it('throws a descriptive error when a segment is not valid Base64url', () => {
    const dom = createDom();
    evalScript(dom, 'converters/jwt-decoder.js');

    expect(() => dom.window.convertText('!!!.!!!.sig')).toThrow(/Could not decode the JWT header/);
  });

  it('throws a descriptive error when a segment decodes but is not valid JSON', () => {
    const dom = createDom();
    evalScript(dom, 'converters/jwt-decoder.js');

    // "bm90anNvbg" base64url-decodes to the literal text "notjson".
    const notJsonHeader = 'bm90anNvbg';
    expect(() => dom.window.convertText(notJsonHeader + '.' + notJsonHeader + '.sig')).toThrow(
      /did not decode to valid JSON/
    );
  });
});
