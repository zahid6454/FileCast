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

// FC.classifyError — converters throw a plain `new Error(...)` for expected
// input-validation rejections (or, in one vendored pdf-lib decoder, a bare
// descriptive string); any other error shape (TypeError, DOMException, a
// worker-boundary error re-tagged by FC.errorFromType, ...) is an
// unanticipated crash. Lets the admin errors feed tell the two apart, and
// stops a bare-string throw's real message from being silently swallowed by
// a generic fallback.
describe('fc-util.js — FC.classifyError', () => {
  it('classifies a plain Error as validation_error and extracts its message', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(dom.window.FC.classifyError(new Error('bad CSV'), 'fallback')).toEqual({
      message: 'bad CSV',
      errorType: 'validation_error'
    });
  });

  it('classifies a bare string throw as validation_error and returns it as-is', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(dom.window.FC.classifyError('The input is not a PNG file!', 'fallback')).toEqual({
      message: 'The input is not a PNG file!',
      errorType: 'validation_error'
    });
  });

  it('classifies TypeError/DOMException-like/undefined as conversion_error, using the fallback message when there is none', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(dom.window.FC.classifyError(new TypeError('boom'), 'fallback').errorType).toBe(
      'conversion_error'
    );
    expect(dom.window.FC.classifyError({ name: 'NotSupportedError' }, 'fallback')).toEqual({
      message: 'fallback',
      errorType: 'conversion_error'
    });
    expect(dom.window.FC.classifyError(undefined, 'fallback')).toEqual({
      message: 'fallback',
      errorType: 'conversion_error'
    });
  });

  it('falls back for an empty string or a message-less error', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    expect(dom.window.FC.classifyError('', 'fallback').message).toBe('fallback');
    expect(dom.window.FC.classifyError({}, 'fallback').message).toBe('fallback');
  });
});

// FC.errorFromType — the reverse direction, used to reconstruct a real Error
// (to reject a Promise with) from a worker's postMessage'd {error, errorType}
// data, and by a converter's own "config not wired up" pre-flight guard. Must
// round-trip through FC.classifyError correctly.
describe('fc-util.js — FC.errorFromType', () => {
  it('produces an Error that FC.classifyError reads back as validation_error', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    const err = dom.window.FC.errorFromType('bad input', 'validation_error');
    expect(err).toBeInstanceOf(dom.window.Error);
    expect(err.message).toBe('bad input');
    expect(dom.window.FC.classifyError(err, 'fallback').errorType).toBe('validation_error');
  });

  it('produces an Error that FC.classifyError reads back as conversion_error', () => {
    const dom = createDom();
    evalScript(dom, 'fc-util.js');
    const err = dom.window.FC.errorFromType('Split is unavailable right now.', 'conversion_error');
    expect(err.message).toBe('Split is unavailable right now.');
    expect(dom.window.FC.classifyError(err, 'fallback').errorType).toBe('conversion_error');
  });
});
