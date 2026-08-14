import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// tools.js's Sync Tools button (Admin-Tool-Sync-Plan.md D7): a POST to
// /admin/seed-tools, then poll GET /admin/seed-tools/{run_id} to a terminal
// conclusion — the same dispatch/poll shape as app.js's Publish button
// (mirrored in admin-deploy-poll.test.js), just scoped to its own button in
// the Tools tab instead of the app-shell banner.

function makeResponse(status, bodyText) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(bodyText === undefined ? '' : bodyText)
  });
}

// Replace the window's timers with a queue we can step by delay, so the
// 3000ms poll interval can be driven independently of the toast timers
// sharing the same queue.
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

const POLL_MS = 3000;

const TOOLS_BODY = JSON.stringify({
  tools: [
    {
      id: 'jpg-to-png',
      category: 'image-conversion',
      name: 'JPG to PNG',
      enabled: true,
      sort_order: 1
    }
  ]
});

function load(fetchImpl) {
  const dom = createDom('<div id="admin-app"><div id="tools-tab"></div></div>');
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  dom.window.fetch = fetchImpl;
  const run = installTimers(dom);
  evalScript(dom, 'admin/dom.js');
  evalScript(dom, 'admin/api.js');
  evalScript(dom, 'admin/app.js');
  evalScript(dom, 'admin/tools.js');
  return { dom, run, ADMIN: dom.window.ADMIN };
}

// A fetch stub that dispatches the seed-tools POST/GET separately from the
// plain GET /api/v1/tools calls (the initial load, and the refresh render()
// triggers on a successful sync).
function seedFetch(statusResponses) {
  const seedCalls = [];
  let i = 0;
  const impl = (url) => {
    if (url.indexOf('/api/v1/admin/seed-tools/') >= 0) {
      seedCalls.push(url);
      const next = statusResponses[Math.min(i++, statusResponses.length - 1)];
      return next();
    }
    if (url.indexOf('/api/v1/admin/seed-tools') >= 0) {
      return makeResponse(200, '{"seed_id": "abc", "run_id": 42, "status": "queued"}');
    }
    return makeResponse(200, TOOLS_BODY);
  };
  impl.seedCalls = seedCalls;
  return impl;
}

async function renderTools(ctx) {
  const container = ctx.dom.window.document.getElementById('tools-tab');
  ctx.ADMIN.tabs.tools.render(container);
  await flush();
  return container;
}

function syncButton(container) {
  return container.querySelector('.admin-tools-actions button');
}

describe('admin/tools.js — Sync Tools status polling', () => {
  it('polls until a terminal conclusion and reports success', async () => {
    const fetchImpl = seedFetch([
      () => makeResponse(200, '{"status":"in_progress"}'),
      () => makeResponse(200, '{"status":"completed","conclusion":"success"}')
    ]);
    const ctx = load(fetchImpl);
    const container = await renderTools(ctx);
    const btn = syncButton(container);
    expect(btn.textContent).toBe('Sync Tools');

    btn.click();
    await flush();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Syncing…');
    expect(fetchImpl.seedCalls).toHaveLength(1);

    await ctx.run(POLL_MS);
    expect(fetchImpl.seedCalls).toHaveLength(2);
    expect(ctx.dom.window.document.body.textContent).toContain('Tools synced');

    // Terminal — no further poll was scheduled.
    await ctx.run(POLL_MS);
    expect(fetchImpl.seedCalls).toHaveLength(2);
  });

  it('shows the Sync Tools button even when the tools list is empty', async () => {
    // An empty table is exactly the state that most needs a sync (a fresh,
    // not-yet-seeded deploy) — the button must not disappear along with the
    // rest of the tools UI in that case.
    const ctx = load((url) => {
      if (url.indexOf('/api/v1/admin/seed-tools') >= 0) {
        return makeResponse(200, '{"run_id": 42, "status": "queued"}');
      }
      return makeResponse(200, '{"tools": []}');
    });
    const container = await renderTools(ctx);
    const btn = syncButton(container);
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Sync Tools');
    expect(container.textContent).toContain('No tools found.');
  });

  it('does not clobber a different tab if the admin navigated away before the sync finished', async () => {
    // CONTAINER is app.js's single shared <main> that every tab renders
    // into. If the admin switches to another tab while a sync is still
    // running, the eventual success must not blow that tab's content away.
    const fetchImpl = seedFetch([
      () => makeResponse(200, '{"status":"completed","conclusion":"success"}')
    ]);
    const ctx = load(fetchImpl);
    const container = await renderTools(ctx);
    syncButton(container).click();
    await flush();

    // Simulate app.js's route() rendering a different tab into the same
    // shared container.
    container.textContent = '';
    const otherTabContent = ctx.dom.window.document.createElement('div');
    otherTabContent.textContent = 'Settings tab content';
    container.appendChild(otherTabContent);

    await ctx.run(POLL_MS);

    // The other tab's content survives — a stale sync completion did not
    // overwrite it with the Tools list.
    expect(container.textContent).toContain('Settings tab content');
    expect(container.querySelector('.admin-tools')).toBeNull();
  });

  it('says so when the run completed but did not succeed', async () => {
    const ctx = load(
      seedFetch([() => makeResponse(200, '{"status":"completed","conclusion":"failure"}')])
    );
    const container = await renderTools(ctx);
    syncButton(container).click();
    await flush();
    // 'completed' is not success — GitHub uses it for failure/cancelled too.
    expect(ctx.dom.window.document.body.textContent).toContain('Sync failed');
    const btn = syncButton(container);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Sync Tools');
  });

  it('retries a poll error a bounded number of times, then gives up', async () => {
    const fetchImpl = seedFetch([() => makeResponse(502, '{"detail":"bad gateway"}')]);
    const ctx = load(fetchImpl);
    const container = await renderTools(ctx);
    syncButton(container).click();
    await flush();
    expect(fetchImpl.seedCalls).toHaveLength(1);

    // Two retries follow the initial failure, then polling stops. Unbounded
    // retry would spin forever against a permanently invalid run_id.
    await ctx.run(POLL_MS);
    expect(fetchImpl.seedCalls).toHaveLength(2);
    await ctx.run(POLL_MS);
    expect(fetchImpl.seedCalls).toHaveLength(3);
    await ctx.run(POLL_MS);
    expect(fetchImpl.seedCalls).toHaveLength(3);

    const btn = syncButton(container);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Sync Tools');
  });

  it('resets the button without polling when seed-tools is not configured (501)', async () => {
    const ctx = load((url) => {
      if (url.indexOf('/api/v1/admin/seed-tools') >= 0) {
        return makeResponse(501, '{"detail":"Sync Tools is not configured"}');
      }
      return makeResponse(200, TOOLS_BODY);
    });
    const container = await renderTools(ctx);
    const btn = syncButton(container);
    btn.click();
    await flush();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Sync Tools');
  });

  it('resets the button and toasts on a dispatch failure', async () => {
    const ctx = load((url) => {
      if (url.indexOf('/api/v1/admin/seed-tools') >= 0) {
        return makeResponse(502, '{"detail":"bad gateway"}');
      }
      return makeResponse(200, TOOLS_BODY);
    });
    const container = await renderTools(ctx);
    const btn = syncButton(container);
    btn.click();
    await flush();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Sync Tools');
    expect(ctx.dom.window.document.body.textContent).toContain('Sync could not start');
  });
});
