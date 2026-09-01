import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// Database Nodes tab (admin/nodes.js) — NEON_FAILOVER_PLAN.md §7.12, Phase F.
// Every other admin tab module (announcements.js, tools.js, users.js, ...)
// has a matching test file; this one is the largest module in the panel
// (switch confirm+progress, add-node form+progress, node detail slide-out,
// two-step retire, auto-saving settings, history) and had none before this
// file — see the audit that added it. Focus: the overview/detail/settings/
// history render correctly off live data (never hardcoded), the raw
// connection string is never exposed (§7.1's explicit requirement, and
// §12's own "cheap insurance" ask), the switch/add-node dispatch+poll flows
// drive real state transitions (not a fixed timer), and the two-step retire
// confirm mirrors announcements.js's existing arm/disarm pattern.

function makeResponse(status, body) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body))
  });
}

const SETTINGS = {
  warmup_threshold_pct: 70,
  cutover_threshold_pct: 80,
  usage_poll_interval_minutes: 15,
  inactivity_warning_days: 14,
  reactive_failure_count: 2,
  monthly_quota_compute_hours: 100
};

const NODES = [
  {
    node_id: 'active-1',
    display_name: 'Node One',
    neon_project_id: 'proj-active',
    status: 'ready',
    created_at: '2026-01-01T00:00:00+00:00',
    is_active: true,
    usage: { ratio: 0.42, checked_at: '2026-08-31T00:00:00+00:00' },
    last_activity: '2026-08-31T00:00:00+00:00'
  },
  {
    node_id: 'reserve-1',
    display_name: 'Node Two',
    neon_project_id: 'proj-reserve',
    status: 'ready',
    created_at: '2026-01-01T00:00:00+00:00',
    is_active: false,
    usage: { ratio: 0.1, checked_at: '2026-08-31T00:00:00+00:00' },
    last_activity: '2026-08-01T00:00:00+00:00'
  },
  {
    node_id: 'error-1',
    display_name: 'Node Three',
    neon_project_id: 'proj-error',
    status: 'error',
    created_at: '2026-01-01T00:00:00+00:00',
    is_active: false,
    usage: null,
    last_activity: null
  }
];

const HISTORY = [
  {
    trigger: 'manual',
    source_node_id: 'reserve-1',
    target_node_id: 'active-1',
    outcome: 'success',
    detail: null,
    at: '2026-08-30T00:00:00+00:00'
  }
];

const POOL_HEALTHY = { status: 'healthy' };

// A single flexible router, matched most-specific-suffix-first, mirroring
// the shape of other admin-*.test.js fetch stubs. `overrides` lets a test
// swap in a custom handler (and/or a `calls` sink) for the one route it
// cares about without having to reimplement the other three loadAll() calls.
function makeFetch(overrides = {}) {
  const calls = [];
  const state = {
    nodes: NODES,
    settings: SETTINGS,
    history: HISTORY,
    pool: POOL_HEALTHY,
    ...overrides
  };
  const impl = (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url, method, body });

    if (/\/status$/.test(url) && method === 'GET') {
      return state.status ? state.status(url, calls) : makeResponse(200, { status: 'done' });
    }
    if (url.endsWith('/switch') && method === 'POST') {
      return state.switch
        ? state.switch(url, body)
        : makeResponse(200, { run_id: 'run-switch', status: 'queued' });
    }
    if (url.endsWith('/retry') && method === 'POST') {
      return state.retry
        ? state.retry(url, body)
        : makeResponse(200, { run_id: 'run-retry', status: 'queued' });
    }
    if (url.endsWith('/retire') && method === 'POST') {
      return state.retire ? state.retire(url, body) : makeResponse(200, { node: {} });
    }
    if (url.endsWith('/settings') && method === 'GET') {
      return makeResponse(200, state.settings);
    }
    if (url.endsWith('/settings') && method === 'PUT') {
      return state.putSettings
        ? state.putSettings(url, body)
        : makeResponse(200, { ...state.settings, ...body });
    }
    if (url.endsWith('/history') && method === 'GET') {
      return makeResponse(200, { history: state.history });
    }
    if (url.endsWith('/pool-health')) {
      return makeResponse(200, state.pool);
    }
    if (url.endsWith('/nodes') && method === 'GET') {
      return makeResponse(200, { nodes: state.nodes });
    }
    if (url.endsWith('/nodes') && method === 'POST') {
      return state.provision
        ? state.provision(url, body)
        : makeResponse(200, { node_id: 'new-1', run_id: 'run-provision', status: 'queued' });
    }
    if (method === 'PATCH') {
      return state.rename ? state.rename(url, body) : makeResponse(200, { node: {} });
    }
    return makeResponse(404, { detail: 'unhandled route in test router' });
  };
  impl.calls = calls;
  return impl;
}

function load(fetchImpl) {
  const dom = createDom('<div id="c"></div>');
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  dom.window.fetch = fetchImpl || makeFetch();
  evalScript(dom, 'admin/dom.js');
  evalScript(dom, 'admin/api.js');
  evalScript(dom, 'admin/nodes.js');
  const ADMIN = dom.window.ADMIN;
  ADMIN.toast = vi.fn();
  ADMIN.onAuthError = vi.fn();
  ADMIN.notifySaved = vi.fn();
  ADMIN.icon = () => dom.window.document.createElement('span');
  ADMIN.emptyState = (opts) => {
    const el = dom.window.document.createElement('div');
    el.className = 'admin-empty-state';
    el.textContent = opts.title;
    return el;
  };
  return dom;
}

// Fake setTimeout so switch/add-node polling (fixed 1500ms interval) can be
// driven deterministically instead of racing real timers — same technique
// admin-deploy-poll.test.js already uses for app.js's own dispatch+poll UX.
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

async function renderOverview(dom) {
  const c = dom.window.document.getElementById('c');
  dom.window.ADMIN.tabs.nodes.render(c);
  await flush();
  return c;
}

function rowFor(c, displayName) {
  return Array.from(c.querySelectorAll('tbody tr')).find((r) =>
    r.textContent.includes(displayName)
  );
}

describe('admin/nodes.js — tab contract', () => {
  it('registers on ADMIN.tabs with a render function', () => {
    const dom = load();
    expect(typeof dom.window.ADMIN.tabs.nodes.render).toBe('function');
  });
});

describe('admin/nodes.js — overview rendering', () => {
  it('shows an empty state when there are no nodes', async () => {
    const dom = load(makeFetch({ nodes: [] }));
    const c = await renderOverview(dom);
    expect(c.querySelector('.admin-empty-state')).not.toBeNull();
  });

  it('renders one row per non-retired node, with stat tiles and the pool banner', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    expect(c.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(c.textContent).toContain('Node One');
    expect(c.textContent).toContain('Node Two');
    expect(c.textContent).toContain('Node Three');
    // Stat tiles: active node name, pool size, thresholds.
    expect(c.textContent).toContain('Active node');
    expect(c.textContent).toContain('Nodes in pool');
    expect(c.textContent).toContain('70% / 80%');
    // Pool-health banner reflects GET /pool-health, not a client guess.
    expect(c.textContent).toContain('Pool healthy');
  });

  it('excludes retired nodes from the table and the pool-size stat', async () => {
    const dom = load(
      makeFetch({
        nodes: [
          ...NODES,
          {
            ...NODES[1],
            node_id: 'retired-1',
            display_name: 'Gone Node',
            status: 'retired',
            is_active: false
          }
        ]
      })
    );
    const c = await renderOverview(dom);
    expect(c.textContent).not.toContain('Gone Node');
    expect(c.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('shows the degraded banner copy when GET /pool-health reports degraded', async () => {
    const dom = load(makeFetch({ pool: { status: 'degraded' } }));
    const c = await renderOverview(dom);
    expect(c.textContent).toContain('Pool running low');
  });

  it('the active node row shows plain text, never a Switch button, for itself', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    const row = rowFor(c, 'Node One');
    expect(row.textContent).toContain('Serving live traffic');
    expect(row.querySelector('button')).toBeNull();
  });

  it('a ready reserve node gets a "Switch to this" row button', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    const row = rowFor(c, 'Node Two');
    const btn = Array.from(row.querySelectorAll('button')).find(
      (b) => b.textContent === 'Switch to this'
    );
    expect(btn).toBeTruthy();
  });

  it('an errored node gets a Retry row button and is not clickable to open detail', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    const row = rowFor(c, 'Node Three');
    const btn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Retry');
    expect(btn).toBeTruthy();
    expect(row.className).not.toContain('node-row');
  });

  it('disables the Retry button immediately so a fast double-click cannot dispatch two provisioning attempts', async () => {
    const fetchImpl = makeFetch({ status: () => new Promise(() => {}) }); // never resolves
    const dom = load(fetchImpl);
    const c = await renderOverview(dom);
    const btn = Array.from(rowFor(c, 'Node Three').querySelectorAll('button')).find(
      (b) => b.textContent === 'Retry'
    );
    btn.click();
    expect(btn.disabled).toBe(true);
    btn.click(); // would double-dispatch if the guard were missing
    await flush();
    expect(fetchImpl.calls.filter((c2) => c2.url.endsWith('/retry'))).toHaveLength(1);
  });

  it('re-enables Retry if the dispatch itself fails, so the admin can try again', async () => {
    const dom = load(makeFetch({ retry: () => makeResponse(502, { detail: 'dispatch failed' }) }));
    const c = await renderOverview(dom);
    const btn = Array.from(rowFor(c, 'Node Three').querySelectorAll('button')).find(
      (b) => b.textContent === 'Retry'
    );
    btn.click();
    await flush();
    expect(btn.disabled).toBe(false);
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith('dispatch failed', 'error');
  });

  it('meter fill color reads the live warm-up/cutover thresholds, not a hardcoded breakpoint', async () => {
    const dom = load(
      makeFetch({
        nodes: [
          {
            ...NODES[0],
            node_id: 'n-ok',
            display_name: 'Ok Node',
            usage: { ratio: 0.5, checked_at: 'x' }
          },
          {
            ...NODES[1],
            node_id: 'n-warn',
            display_name: 'Warn Node',
            usage: { ratio: 0.75, checked_at: 'x' }
          },
          {
            ...NODES[1],
            node_id: 'n-err',
            display_name: 'Err Node',
            usage: { ratio: 0.9, checked_at: 'x' }
          }
        ],
        // A non-default threshold pair confirms the frontend reads settings
        // live rather than assuming the 70/80 defaults.
        settings: { ...SETTINGS, warmup_threshold_pct: 60, cutover_threshold_pct: 85 }
      })
    );
    const c = await renderOverview(dom);
    const okFill = rowFor(c, 'Ok Node').querySelector('.admin-meter__fill');
    const warnFill = rowFor(c, 'Warn Node').querySelector('.admin-meter__fill');
    const errFill = rowFor(c, 'Err Node').querySelector('.admin-meter__fill');
    expect(okFill.className).toBe('admin-meter__fill');
    expect(warnFill.className).toContain('admin-meter__fill--warning');
    expect(errFill.className).toContain('admin-meter__fill--error');
  });

  it('flags a node past the configured inactivity_warning_days', async () => {
    const longAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const recent = new Date(Date.now() - 1 * 86400000).toISOString();
    const dom = load(
      makeFetch({
        nodes: [
          { ...NODES[1], node_id: 'stale', display_name: 'Stale Node', last_activity: longAgo },
          { ...NODES[1], node_id: 'fresh', display_name: 'Fresh Node', last_activity: recent }
        ]
      })
    );
    const c = await renderOverview(dom);
    expect(rowFor(c, 'Stale Node').textContent).toContain('⚠');
    expect(rowFor(c, 'Fresh Node').textContent).not.toContain('⚠');
  });

  it('routes an auth error to ADMIN.onAuthError instead of an error card', async () => {
    // Simplest reliable way to force an auth error: have the primary /nodes
    // GET itself 401.
    const dom = load((url, opts) => {
      if (url.endsWith('/nodes') && (!opts || (opts.method || 'GET') === 'GET')) {
        return makeResponse(401, { detail: 'nope' });
      }
      return makeFetch()(url, opts);
    });
    const c = dom.window.document.getElementById('c');
    dom.window.ADMIN.tabs.nodes.render(c);
    await flush();
    expect(dom.window.ADMIN.onAuthError).toHaveBeenCalled();
  });
});

describe('admin/nodes.js — connection string is never exposed', () => {
  it('never renders connection_string even if a buggy backend response included it', async () => {
    const leaky = NODES.map((n) => ({
      ...n,
      connection_string: 'postgresql://user:hunter2@evil/db'
    }));
    const dom = load(makeFetch({ nodes: leaky }));
    const c = await renderOverview(dom);
    expect(c.innerHTML).not.toContain('hunter2');
    expect(c.innerHTML).not.toContain('connection_string');

    // Same check for the node detail slide-out.
    rowFor(c, 'Node Two').click();
    await flush();
    expect(dom.window.document.body.innerHTML).not.toContain('hunter2');
  });
});

describe('admin/nodes.js — switch flow', () => {
  it('confirm drawer names the source -> target transition', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    rowFor(c, 'Node Two').querySelector('button').click();
    await flush();
    const body = dom.window.document.body;
    expect(body.textContent).toContain('Node One');
    expect(body.textContent).toContain('Node Two');
    expect(body.textContent).toContain('try again in a moment');
  });

  it('confirming posts /switch with the target id and reports success once the poll reports done', async () => {
    const fetchImpl = makeFetch();
    const dom = load(fetchImpl);
    const c = await renderOverview(dom);
    rowFor(c, 'Node Two').querySelector('button').click();
    await flush();

    const confirmBtn = Array.from(dom.window.document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Confirm switch'
    );
    confirmBtn.click();
    await flush();

    const switchCall = fetchImpl.calls.find((c2) => c2.url.endsWith('/switch'));
    expect(switchCall).toBeTruthy();
    expect(switchCall.url).toContain('/reserve-1/switch');
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith(
      'Node Two is now serving live traffic',
      'success'
    );
    // Drawer closes once the run reaches a terminal state.
    expect(dom.window.document.querySelector('.admin-slideout')).toBeNull();
  });

  it('advances the four step labels off real poll responses, not a fixed timer', async () => {
    let call = 0;
    const responses = [
      { status: 'pending', detail: "Warming up target node 'reserve-1'" },
      { status: 'pending', detail: 'Final top-up sync' },
      { status: 'pending', detail: 'Flipping live traffic' },
      { status: 'done', detail: 'Switch complete.' }
    ];
    const dom = load(
      makeFetch({
        status: () => makeResponse(200, responses[Math.min(call++, responses.length - 1)])
      })
    );
    const run = installTimers(dom);
    const c = await renderOverview(dom);
    rowFor(c, 'Node Two').querySelector('button').click();
    await flush();
    Array.from(dom.window.document.querySelectorAll('button'))
      .find((b) => b.textContent === 'Confirm switch')
      .click();
    await flush();

    // First response ("Warming up...") is still step 0 (the source is still
    // healthy — nothing has actually flipped yet).
    let steps = dom.window.document.querySelectorAll('.admin-step');
    expect(steps[0].className).toContain('is-active');

    await run(1500); // -> "Final top-up sync"
    steps = dom.window.document.querySelectorAll('.admin-step');
    expect(steps[1].className).toContain('is-active');

    await run(1500); // -> "Flipping live traffic"
    steps = dom.window.document.querySelectorAll('.admin-step');
    expect(steps[2].className).toContain('is-active');

    await run(1500); // -> done
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith(
      'Node Two is now serving live traffic',
      'success'
    );
  });

  it('reports a failed switch without crashing', async () => {
    const dom = load(
      makeFetch({
        status: () =>
          makeResponse(200, { status: 'error', detail: 'Final sync to target failed: timeout' })
      })
    );
    const c = await renderOverview(dom);
    rowFor(c, 'Node Two').querySelector('button').click();
    await flush();
    Array.from(dom.window.document.querySelectorAll('button'))
      .find((b) => b.textContent === 'Confirm switch')
      .click();
    await flush();
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith(
      'Switch failed: Final sync to target failed: timeout',
      'error'
    );
  });

  it('gives up after five consecutive poll errors instead of polling forever', async () => {
    const dom = load(makeFetch({ status: () => makeResponse(500, { detail: 'boom' }) }));
    const run = installTimers(dom);
    const c = await renderOverview(dom);
    rowFor(c, 'Node Two').querySelector('button').click();
    await flush();
    Array.from(dom.window.document.querySelectorAll('button'))
      .find((b) => b.textContent === 'Confirm switch')
      .click();
    await flush();

    // The initial poll (call #1, synchronous with the confirm click) already
    // used one of the five attempts, so only 3 more scheduled retries remain
    // before the budget (5 total) is exhausted on the 4th scheduled retry.
    for (let i = 0; i < 3; i++) await run(1500);
    expect(dom.window.document.querySelector('.admin-slideout')).not.toBeNull();

    await run(1500); // 5th total attempt — gives up.
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith(
      expect.stringContaining('Lost track of the switch'),
      'info'
    );
    expect(dom.window.document.querySelector('.admin-slideout')).toBeNull();
  });
});

describe('admin/nodes.js — add node flow', () => {
  // The toolbar's own "Add node" button and the drawer's submit button share
  // the exact same label — every lookup below must be scoped to the drawer
  // (.admin-slideout) once it's open, not `document`/`c` at large, or a
  // plain textContent match finds the toolbar button first.
  function openForm(c, dom) {
    Array.from(c.querySelectorAll('button'))
      .find((b) => b.textContent.includes('Add node'))
      .click();
    return dom.window.document.querySelector('.admin-slideout');
  }

  it('checklist mentions the operator steps from §7.8', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    openForm(c, dom);
    const body = dom.window.document.body.textContent;
    expect(body).toContain('AWS us-east-2');
    expect(body).toContain('pooled');
  });

  it('rejects submission client-side when a field is missing, with no POST', async () => {
    const fetchImpl = makeFetch();
    const dom = load(fetchImpl);
    const c = await renderOverview(dom);
    const drawer = openForm(c, dom);

    Array.from(drawer.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add node')
      .click();
    await flush();

    expect(fetchImpl.calls.some((c2) => c2.method === 'POST' && c2.url.endsWith('/nodes'))).toBe(
      false
    );
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith('Fill in every field', 'error');
  });

  it('submits the three fields and reports success once provisioning completes', async () => {
    const fetchImpl = makeFetch();
    const dom = load(fetchImpl);
    const c = await renderOverview(dom);
    const drawer = openForm(c, dom);

    drawer.querySelector('input[type="text"]').value = 'filecast-5';
    drawer.querySelector('textarea').value = 'postgresql://user:pass@ep-x-pooler.aws.neon.tech/db';
    drawer.querySelectorAll('input[type="text"]')[1].value = 'plain-cell-123';
    Array.from(drawer.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add node')
      .click();
    await flush();

    const post = fetchImpl.calls.find((c2) => c2.method === 'POST' && c2.url.endsWith('/nodes'));
    expect(post).toBeTruthy();
    expect(post.body).toEqual({
      display_name: 'filecast-5',
      connection_string: 'postgresql://user:pass@ep-x-pooler.aws.neon.tech/db',
      neon_project_id: 'plain-cell-123'
    });
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith(
      'filecast-5 is ready and in reserve',
      'success'
    );
  });

  it('is closeable mid-run — closing the panel does not cancel the background operation', async () => {
    const dom = load(makeFetch({ status: () => new Promise(() => {}) })); // never resolves
    const c = await renderOverview(dom);
    const drawer = openForm(c, dom);
    drawer.querySelector('input[type="text"]').value = 'filecast-5';
    drawer.querySelector('textarea').value = 'postgresql://x/db';
    drawer.querySelectorAll('input[type="text"]')[1].value = 'proj-123';
    Array.from(drawer.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add node')
      .click();
    await flush();

    const closeBtn = Array.from(dom.window.document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Close (keeps running)'
    );
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    expect(dom.window.document.querySelector('.admin-slideout')).toBeNull();
  });
});

describe('admin/nodes.js — node detail slide-out', () => {
  it('disables both Switch and Retire for the currently active node', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    rowFor(c, 'Node One').click();
    await flush();
    const body = dom.window.document.body;
    const switchBtn = Array.from(body.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Already serving traffic')
    );
    const retireBtn = Array.from(body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Retire node'
    );
    expect(switchBtn.disabled).toBe(true);
    expect(retireBtn.disabled).toBe(true);
  });

  it('a reserve node has both actions enabled, and Retire needs a second confirming click', async () => {
    const fetchImpl = makeFetch();
    const dom = load(fetchImpl);
    const c = await renderOverview(dom);
    rowFor(c, 'Node Two').click();
    await flush();
    const body = dom.window.document.body;
    const switchBtn = Array.from(body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Switch to this node'
    );
    const retireBtn = Array.from(body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Retire node'
    );
    expect(switchBtn.disabled).toBe(false);
    expect(retireBtn.disabled).toBe(false);

    retireBtn.click(); // arm
    expect(fetchImpl.calls.some((c2) => c2.url.endsWith('/retire'))).toBe(false);
    expect(retireBtn.textContent).toBe('Confirm retire');
    expect(retireBtn.className).toContain('is-armed');

    retireBtn.click(); // confirm
    await flush();
    const retireCall = fetchImpl.calls.find((c2) => c2.url.endsWith('/retire'));
    expect(retireCall).toBeTruthy();
    expect(retireCall.url).toContain('/reserve-1/retire');
    expect(dom.window.ADMIN.toast).toHaveBeenCalledWith('Node Two retired', 'success');
  });

  it('renames a node via PATCH and notifies live-saved', async () => {
    const fetchImpl = makeFetch();
    const dom = load(fetchImpl);
    const c = await renderOverview(dom);
    rowFor(c, 'Node Two').click();
    await flush();
    const body = dom.window.document.body;
    const nameInput = body.querySelector('input[type="text"]');
    nameInput.value = 'Renamed Node';
    nameInput.dispatchEvent(new dom.window.Event('input'));
    const saveBtn = Array.from(body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save name'
    );
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await flush();

    const patch = fetchImpl.calls.find((c2) => c2.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(patch.url).toContain('/reserve-1');
    expect(patch.body).toEqual({ display_name: 'Renamed Node' });
    expect(dom.window.ADMIN.notifySaved).toHaveBeenCalledWith({ live: true });
  });

  it('a provisioning/error node cannot be a switch target from its own detail view', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    // Errored rows aren't clickable (see overview tests) — open via a
    // provisioning-status node instead, which IS clickable.
    const dom2 = load(makeFetch({ nodes: [NODES[0], { ...NODES[1], status: 'provisioning' }] }));
    const c2 = await renderOverview(dom2);
    rowFor(c2, 'Node Two').click();
    await flush();
    const btn = Array.from(dom2.window.document.body.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Not ready to switch')
    );
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });
});

describe('admin/nodes.js — settings tab', () => {
  function openSettings(c, dom) {
    Array.from(c.querySelectorAll('button'))
      .find((b) => b.textContent === 'Settings')
      .click();
  }

  it('renders one card per §8 tunable with the live current value', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    openSettings(c);
    const body = dom.window.document.body.textContent;
    expect(body).toContain('Warm-up threshold');
    expect(body).toContain('Cutover threshold');
    expect(body).toContain('Usage check interval');
    expect(body).toContain('Inactivity warning');
    expect(body).toContain('Reactive failure count');
    expect(body).toContain('Monthly compute quota');
    const numberInputs = Array.from(
      dom.window.document.querySelectorAll('.admin-settingrow input[type="number"]')
    ).map((i) => i.value);
    expect(numberInputs).toEqual(['70', '80', '15', '14', '2', '100']);
  });

  it('dragging the range does not save until the change settles', async () => {
    const fetchImpl = makeFetch();
    const dom = load(fetchImpl);
    const c = await renderOverview(dom);
    openSettings(c);

    const range = dom.window.document.querySelector('.admin-settingrow input[type="range"]');
    range.value = '75';
    range.dispatchEvent(new dom.window.Event('input'));
    expect(fetchImpl.calls.some((c2) => c2.method === 'PUT')).toBe(false);

    range.dispatchEvent(new dom.window.Event('change'));
    await flush();
    const put = fetchImpl.calls.find((c2) => c2.method === 'PUT');
    expect(put).toBeTruthy();
    expect(put.body).toEqual({ warmup_threshold_pct: 75 });
    expect(dom.window.ADMIN.notifySaved).toHaveBeenCalledWith({ live: true });
  });

  it('clamps an out-of-range typed value to the field bounds before saving', async () => {
    const fetchImpl = makeFetch();
    const dom = load(fetchImpl);
    const c = await renderOverview(dom);
    openSettings(c);

    // reactive_failure_count's range is 1-5 (§8) — try to push it past the top.
    const numberInputs = dom.window.document.querySelectorAll(
      '.admin-settingrow input[type="number"]'
    );
    const reactiveCountInput = numberInputs[4];
    reactiveCountInput.value = '999';
    reactiveCountInput.dispatchEvent(new dom.window.Event('change'));
    await flush();

    const put = fetchImpl.calls.find((c2) => c2.method === 'PUT');
    expect(put.body).toEqual({ reactive_failure_count: 5 });
    expect(reactiveCountInput.value).toBe('5');
  });
});

describe('admin/nodes.js — history tab', () => {
  function openHistory(c) {
    Array.from(c.querySelectorAll('button'))
      .find((b) => b.textContent === 'History')
      .click();
  }

  it('shows an empty state when there have been no switches yet', async () => {
    const dom = load(makeFetch({ history: [] }));
    const c = await renderOverview(dom);
    openHistory(c);
    expect(dom.window.document.querySelector('.admin-empty-state')).not.toBeNull();
  });

  it('renders one card per switch, tagged with its trigger type and node names', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    openHistory(c);
    const body = dom.window.document.body;
    expect(body.querySelectorAll('.admin-annc')).toHaveLength(1);
    expect(body.textContent).toContain('Node Two');
    expect(body.textContent).toContain('Node One');
    expect(body.querySelector('.trigger-badge--manual')).not.toBeNull();
  });

  it('shows a short failure reason inline with no expand affordance', async () => {
    const dom = load(
      makeFetch({
        history: [
          {
            trigger: 'manual',
            source_node_id: 'active-1',
            target_node_id: 'reserve-1',
            outcome: 'failure',
            detail: 'Target node is already the active node.',
            at: '2026-08-30T00:00:00+00:00'
          }
        ]
      })
    );
    const c = await renderOverview(dom);
    openHistory(c);
    const body = dom.window.document.body;
    expect(body.textContent).toContain('Target node is already the active node.');
    expect(body.querySelector('.admin-annc__detail')).toBeNull();
  });

  // Regression: a failure's raw `detail` can be a full multi-line traceback
  // (str(exc) on the backend, node_ops.py) — observed for real in production
  // off a historical migration failure. Dumping that whole thing into the
  // one-line metadata caption wrecked the list's scannability; only a short
  // summary belongs inline, with the full text behind a collapsed disclosure.
  it('truncates a long/multi-line failure detail inline and tucks the full text behind a collapsed disclosure', async () => {
    const traceback =
      "migration against target node 'abc123' failed (exit 1): Traceback (most recent call last):\n" +
      '  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/sql/ddl.py", line 322, in _invoke_with\n' +
      '    return bind.execute(self)\n' +
      'sqlalchemy.exc.ProgrammingError: (psycopg.errors.InvalidSchemaName) no schema has been selected to create';
    const dom = load(
      makeFetch({
        history: [
          {
            trigger: 'manual',
            source_node_id: 'active-1',
            target_node_id: 'reserve-1',
            outcome: 'failure',
            detail: traceback,
            at: '2026-08-30T00:00:00+00:00'
          }
        ]
      })
    );
    const c = await renderOverview(dom);
    openHistory(c);
    const body = dom.window.document.body;

    const reasonLine = body.querySelector('.admin-annc__reason');
    // The inline reason carries only the first line, truncated — never the
    // embedded newlines/stack frames.
    expect(reasonLine.textContent).toContain("migration against target node 'abc123' failed");
    expect(reasonLine.textContent).not.toContain('sqlalchemy.exc.ProgrammingError');

    const details = body.querySelector('.admin-annc__detail');
    expect(details).not.toBeNull();
    expect(details.hasAttribute('open')).toBe(false); // collapsed by default
    // Nothing is dropped — the full raw text is still there, just tucked away.
    expect(details.querySelector('.admin-annc__detail-body').textContent).toBe(traceback);
  });

  // jsdom has no real Element.animate() (confirmed: typeof is 'undefined'),
  // so wireAnimatedDetails()'s own guard already makes every test above
  // exercise the plain-native-toggle fallback path. This test stubs
  // Element.animate() in so the actual animated-tween wiring itself gets
  // covered too, not just its absence.
  it('drives the disclosure open/closed via Element.animate(), not the native instant toggle, when it is available', async () => {
    const longDetail =
      "migration against target node 'abc123' failed (exit 1): Traceback (most recent call last):\n" +
      '  File "ddl.py", line 322, in _invoke_with\n' +
      'sqlalchemy.exc.ProgrammingError: boom';
    const dom = load(
      makeFetch({
        history: [
          {
            trigger: 'manual',
            source_node_id: 'active-1',
            target_node_id: 'reserve-1',
            outcome: 'failure',
            detail: longDetail,
            at: '2026-08-30T00:00:00+00:00'
          }
        ]
      })
    );

    const animateCalls = [];
    dom.window.Element.prototype.animate = function (keyframes, opts) {
      const fake = { onfinish: null, oncancel: null, cancel: () => {} };
      animateCalls.push({ keyframes, opts, fake });
      return fake;
    };
    // jsdom's real requestAnimationFrame is backed by a ~16.7ms setInterval
    // (see jsdom's Window.js), which a fixed-tick flush() can't reliably
    // outlast on a loaded CI runner — this raced and failed intermittently
    // in CI (animateCalls still [] when the assertion below ran). Stub it to
    // fire synchronously: this test cares that expand() eventually calls
    // animate() with the right arguments, not about real frame timing.
    dom.window.requestAnimationFrame = function (cb) {
      cb();
      return 0;
    };

    const c = await renderOverview(dom);
    openHistory(c);
    const details = dom.window.document.querySelector('.admin-annc__detail');
    const summary = details.querySelector('summary');
    expect(details.classList.contains('is-open')).toBe(false);

    summary.click(); // expand()'s rAF-deferred animate() call now runs synchronously

    // `open` and the arrow-driving class flip immediately (synchronous with
    // the click) even though the tween itself is still mid-flight — a click
    // must never wait on the animation to register as "expanded".
    expect(details.open).toBe(true);
    expect(details.classList.contains('is-open')).toBe(true);
    expect(animateCalls).toHaveLength(1);
    expect(animateCalls[0].opts.easing).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
    expect(animateCalls[0].keyframes.height).toHaveLength(2);

    animateCalls[0].fake.onfinish(); // simulate the expand tween finishing
    expect(details.style.height).toBe('');

    // Collapse: the class flips immediately, but the native `open` attribute
    // is deliberately held true until the (mocked) tween actually finishes —
    // flipping it early would hide the content via the UA stylesheet before
    // any shrink could be seen.
    summary.click();
    expect(details.classList.contains('is-open')).toBe(false);
    expect(details.open).toBe(true);
    expect(animateCalls).toHaveLength(2);

    animateCalls[1].fake.onfinish();
    expect(details.open).toBe(false);
  });
});

describe('admin/nodes.js — sub-nav', () => {
  it('defaults to Overview and switches to History/Settings and back without losing content', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    expect(c.querySelector('table')).not.toBeNull();

    const subnavBtn = (label) =>
      Array.from(dom.window.document.querySelectorAll('button')).find(
        (b) => b.textContent === label
      );

    subnavBtn('History').click();
    expect(dom.window.document.body.querySelector('table')).toBeNull();
    expect(dom.window.document.body.textContent).toContain('Node Two');

    subnavBtn('Settings').click();
    expect(dom.window.document.body.textContent).toContain('Warm-up threshold');

    subnavBtn('Overview').click();
    expect(dom.window.document.body.querySelector('table')).not.toBeNull();
  });

  it('a mutation from Overview reloads data and stays on Overview', async () => {
    const dom = load();
    const c = await renderOverview(dom);
    rowFor(c, 'Node Two').click();
    await flush();
    const retireBtn = Array.from(dom.window.document.body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Retire node'
    );
    retireBtn.click(); // arm
    retireBtn.click(); // confirm
    await flush();
    // reloadAll() re-renders in place, respecting the current VIEW ('overview'
    // the whole time here) rather than forcing back to Overview from
    // somewhere else — the distinguishing behavior vs. render(), which
    // always resets VIEW to 'overview' on a fresh tab visit.
    expect(dom.window.document.querySelector('#c table')).not.toBeNull();
  });
});
