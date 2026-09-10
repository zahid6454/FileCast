import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// FC.setSentryContext (P2 §24) — custom Sentry context attached at
// conversion_started, so an uncaught error during a conversion carries
// tool/file/mode instead of a bare stack trace. Guarded the same way
// analytics.js guards Sentry.init(): a blocked/failed CDN load must not throw.

describe('fc-util.js — FC.setSentryContext', () => {
  it('calls Sentry.setContext("conversion", data) when the SDK is present', () => {
    const dom = createDom();
    const setContext = vi.fn();
    dom.window.Sentry = { setContext };
    evalScript(dom, 'fc-util.js');

    const data = { tool_id: 'png-to-jpg', mode: 'Local' };
    dom.window.FC.setSentryContext(data);

    expect(setContext).toHaveBeenCalledWith('conversion', data);
  });

  it('no-ops without throwing when window.Sentry is absent (blocked CDN)', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(() => dom.window.FC.setSentryContext({ tool_id: 'x' })).not.toThrow();
  });

  it('no-ops when Sentry exists but setContext is not a function', () => {
    const dom = createDom();
    dom.window.Sentry = {};
    evalScript(dom, 'fc-util.js');
    expect(() => dom.window.FC.setSentryContext({ tool_id: 'x' })).not.toThrow();
  });
});

// FC.errorTypeFromError / FC.errorMessage — converters throw a plain
// `new Error(...)` for expected input-validation rejections (or, in one
// vendored pdf-lib decoder, a bare descriptive string); any other error
// shape (TypeError, DOMException, ...) is an unanticipated crash. Lets the
// admin errors feed tell the two apart, and stops a bare-string throw's
// real message from being silently swallowed by a generic fallback.
describe('fc-util.js — FC.errorTypeFromError', () => {
  it('classifies a plain Error as validation_error', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(dom.window.FC.errorTypeFromError(new Error('bad input'))).toBe('validation_error');
  });

  it('classifies a bare string throw as validation_error', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(dom.window.FC.errorTypeFromError('The input is not a PNG file!')).toBe(
      'validation_error'
    );
  });

  it('classifies TypeError/DOMException-like/undefined as conversion_error', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(dom.window.FC.errorTypeFromError(new TypeError('boom'))).toBe('conversion_error');
    expect(dom.window.FC.errorTypeFromError({ name: 'NotSupportedError' })).toBe(
      'conversion_error'
    );
    expect(dom.window.FC.errorTypeFromError(undefined)).toBe('conversion_error');
  });
});

describe('fc-util.js — FC.errorMessage', () => {
  it('extracts .message from an Error', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(dom.window.FC.errorMessage(new Error('bad CSV'), 'fallback')).toBe('bad CSV');
  });

  it('returns a bare string throw as-is', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(dom.window.FC.errorMessage('The input is not a PNG file!', 'fallback')).toBe(
      'The input is not a PNG file!'
    );
  });

  it('falls back for an empty string, a message-less error, or a missing error', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(dom.window.FC.errorMessage('', 'fallback')).toBe('fallback');
    expect(dom.window.FC.errorMessage({}, 'fallback')).toBe('fallback');
    expect(dom.window.FC.errorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
