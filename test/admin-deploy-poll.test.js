import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// app.js's save → publish flow: notifySaved() debounces a POST /admin/deploy,
// then polls GET /admin/deploy/{run_id} to a terminal conclusion. Phase 9 §5
// item 2 made a poll ERROR retry a bounded number of times instead of ending
// polling on the first blip — bounded because an invalid run_id 502s forever.

function makeResponse(status, bodyText) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(bodyText === undefined ? '' : bodyText)
  });
}

// Replace the window's timers with a queue we can step by delay, so the 700ms
// debounce and the 4000ms poll interval can be driven independently of the
// toast timers sharing the same queue.
function installTimers(dom) {
  const queue = [];
  dom.window.setTimeout = (fn, ms) => {
    queue.push({ fn, ms: ms || 0 });
    return queue.length;
  };
  dom.window.clearTimeout = () => {};
  return async function run(ms) {
    const due = queue.filter((t) => t.ms === ms);
    for (const t of due) queue.splice(queue.indexOf(t), 1);
    for (const t of due) t.fn();
    await flush();
  };
}

const DEBOUNCE_MS = 700;
const POLL_MS = 4000;

function load(fetchImpl) {
  const dom = createDom('<div id="admin-app"></div>');
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  dom.window.fetch = fetchImpl;
  const run = installTimers(dom);
  evalScript(dom, 'admin/dom.js');
  evalScript(dom, 'admin/api.js');
  evalScript(dom, 'admin/app.js');
  return { dom, run, ADMIN: dom.window.ADMIN };
}

// A fetch stub that dispatches the deploy POST and the status GETs separately.
function deployFetch(statusResponses) {
  const statusCalls = [];
  let i = 0;
  const impl = (url) => {
    if (url.indexOf('/api/v1/admin/deploy/') >= 0) {
      statusCalls.push(url);
      const next = statusResponses[Math.min(i++, statusResponses.length - 1)];
      return next();
    }
    return makeResponse(200, '{"run_id": 42, "status": "queued"}');
  };
  impl.statusCalls = statusCalls;
  return impl;
}

async function startDeploy(ctx) {
  ctx.ADMIN.notifySaved({});
  await ctx.run(DEBOUNCE_MS); // debounce → POST /admin/deploy → first poll
}

describe('admin/app.js — deploy status polling', () => {
  it('polls until a terminal conclusion and reports it', async () => {
    const fetchImpl = deployFetch([
      () => makeResponse(200, '{"status":"in_progress"}'),
      () => makeResponse(200, '{"status":"completed","conclusion":"success"}')
    ]);
    const ctx = load(fetchImpl);
    await startDeploy(ctx);
    expect(fetchImpl.statusCalls).toHaveLength(1);

    await ctx.run(POLL_MS);
    expect(fetchImpl.statusCalls).toHaveLength(2);
    expect(ctx.dom.window.document.body.textContent).toContain('Published');

    // Terminal — no further poll was scheduled.
    await ctx.run(POLL_MS);
    expect(fetchImpl.statusCalls).toHaveLength(2);
  });

  it('says so when the run completed but did not succeed', async () => {
    const ctx = load(
      deployFetch([() => makeResponse(200, '{"status":"completed","conclusion":"failure"}')])
    );
    await startDeploy(ctx);
    // 'completed' is not success — GitHub uses it for failure/cancelled too.
    expect(ctx.dom.window.document.body.textContent).toContain('not live');
  });

  it('retries a poll error a bounded number of times, then gives up', async () => {
    const fetchImpl = deployFetch([() => makeResponse(502, '{"detail":"bad gateway"}')]);
    const ctx = load(fetchImpl);
    await startDeploy(ctx);
    expect(fetchImpl.statusCalls).toHaveLength(1);

    // Two retries follow the initial failure, then polling stops. Unbounded
    // retry would spin forever against a permanently invalid run_id.
    await ctx.run(POLL_MS);
    expect(fetchImpl.statusCalls).toHaveLength(2);
    await ctx.run(POLL_MS);
    expect(fetchImpl.statusCalls).toHaveLength(3);
    await ctx.run(POLL_MS);
    expect(fetchImpl.statusCalls).toHaveLength(3);
  });

  it('recovers from a transient error and still reports the conclusion', async () => {
    // The regression the old stop-on-first-error had: one blip mid-deploy cost
    // the admin the terminal toast entirely.
    const fetchImpl = deployFetch([
      () => makeResponse(502, '{"detail":"blip"}'),
      () => makeResponse(200, '{"status":"completed","conclusion":"success"}')
    ]);
    const ctx = load(fetchImpl);
    await startDeploy(ctx);
    await ctx.run(POLL_MS);
    expect(ctx.dom.window.document.body.textContent).toContain('Published');
  });

  it('resets the error budget after a good response', async () => {
    // Errors either side of a success must not accumulate into an early stop.
    let n = 0;
    const fetchImpl = deployFetch([
      () => {
        n++;
        if (n === 1 || n === 2) return makeResponse(502, '{"detail":"blip"}');
        if (n === 3) return makeResponse(200, '{"status":"in_progress"}');
        if (n === 4 || n === 5) return makeResponse(502, '{"detail":"blip"}');
        return makeResponse(200, '{"status":"completed","conclusion":"success"}');
      }
    ]);
    const ctx = load(fetchImpl);
    await startDeploy(ctx);
    for (let i = 0; i < 5; i++) await ctx.run(POLL_MS);
    expect(fetchImpl.statusCalls).toHaveLength(6);
    expect(ctx.dom.window.document.body.textContent).toContain('Published');
  });

  it('never polls when the deploy endpoint reports notImplemented', async () => {
    const fetchImpl = deployFetch([() => makeResponse(200, '{}')]);
    const ctx = load((url, opts) => {
      if (url.indexOf('/api/v1/admin/deploy/') >= 0) return fetchImpl(url, opts);
      return makeResponse(501, '{"detail":"Deploy is not configured"}');
    });
    await startDeploy(ctx);
    await ctx.run(POLL_MS);
    expect(fetchImpl.statusCalls).toHaveLength(0);
  });
});
