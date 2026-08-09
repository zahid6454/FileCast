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
