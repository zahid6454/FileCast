// A hermetic, stateful mock of the Phase 1 admin API for the admin-panel E2E.
// The admin SPA is served from the static `dist/` (no live API in CI), so we
// intercept every `**/api/v1/**` request and serve fixtures from an in-memory
// "database" that actually mutates — so toggle-persist-on-reload, announcement
// CRUD, and the one-active rule behave like the real backend. The deploy
// endpoint returns 501 exactly like the Phase 1 stub.

export function makeState(overrides = {}) {
  return {
    me: overrides.me || { status: 200, body: { user: { id: 'u1', email: 'admin@dev.local', role: 'admin' } } },
    tools: overrides.tools || [
      { id: 'img-a', enabled: true, sort_order: 1, category: 'image', name: 'Image A', display_name: null, maintenance_message: null, custom_max_file_size: null, input_format: 'A', output_format: 'B' },
      { id: 'img-b', enabled: true, sort_order: 2, category: 'image', name: 'Image B', display_name: null, maintenance_message: null, custom_max_file_size: null, input_format: 'A', output_format: 'B' },
      { id: 'img-c', enabled: false, sort_order: 3, category: 'image', name: 'Image C', display_name: null, maintenance_message: null, custom_max_file_size: null, input_format: 'A', output_format: 'B' },
      { id: 'doc-a', enabled: true, sort_order: 4, category: 'document', name: 'Doc A', display_name: null, maintenance_message: null, custom_max_file_size: null, input_format: 'A', output_format: 'B' },
      { id: 'doc-b', enabled: true, sort_order: 5, category: 'document', name: 'Doc B', display_name: null, maintenance_message: null, custom_max_file_size: null, input_format: 'A', output_format: 'B' },
    ],
    announcements: overrides.announcements || [],
    users: overrides.users || [
      { id: 'u1', email: 'admin@dev.local', name: 'Dev Admin', role: 'admin', created_at: '2026-01-01T00:00:00Z', last_login_at: '2026-07-01T00:00:00Z', max_file_size: null },
      { id: 'u2', email: 'user@dev.local', name: 'Dev User', role: 'user', created_at: '2026-02-01T00:00:00Z', last_login_at: null, max_file_size: null },
    ],
    dashboard: overrides.dashboard || {
      total_conversions: 120,
      total_failures: 6,
      total_users: 2,
      total_ratings: 5,
      yes_ratings: 4,
      top_tools: [
        { tool_id: 'img-a', count: 80 },
        { tool_id: 'doc-a', count: 40 },
      ],
    },
    series: overrides.series || [
      { date: '2026-07-10', count: 10, failures: 1 },
      { date: '2026-07-11', count: 20, failures: 0 },
      { date: '2026-07-12', count: 15, failures: 2 },
    ],
    errors: overrides.errors || [
      { id: 1, tool_id: 'img-a', error_type: 'ConversionError', error_message: '<img src=x onerror="window.__xss=1">', browser: 'Firefox', created_at: '2026-07-13T10:00:00Z' },
      { id: 2, tool_id: 'doc-a', error_type: 'TimeoutError', error_message: 'Gateway timed out', browser: 'Chrome', created_at: '2026-07-13T11:00:00Z' },
    ],
    ratings: overrides.ratings || [
      { tool_id: 'img-a', yes: 4, no: 1 },
      { tool_id: 'doc-a', yes: 3, no: 0 },
    ],
    // Instrumentation for assertions:
    reorderCalls: [],
    ratingsCalls: 0,
    deployCalls: 0,
    _annId: 100,
  };
}

export async function installApi(page, state) {
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname;
    const body = () => {
      try {
        return req.postDataJSON();
      } catch (e) {
        return {};
      }
    };
    const json = (obj, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

    // Simulate a mid-session expiry/demotion: every mutation is refused with 403
    // (and the test flips state.me to 401 so the gate re-check lands on sign-in).
    if (state.failAuth && method !== 'GET') {
      return json({ detail: 'Admin access required' }, 403);
    }

    // --- auth ---
    if (path.endsWith('/auth/me') && method === 'GET') {
      return route.fulfill({
        status: state.me.status,
        contentType: 'application/json',
        body: JSON.stringify(state.me.status === 200 ? state.me.body : { detail: 'auth' }),
      });
    }
    if (path.endsWith('/auth/logout')) {
      state.me = { status: 401 }; // session cleared → /me now 401 on the reload
      return json({ ok: true });
    }

    // --- tools ---
    if (path.endsWith('/tools') && method === 'GET') {
      const sorted = state.tools.slice().sort((a, b) => a.sort_order - b.sort_order);
      return json({ tools: sorted });
    }
    if (path.endsWith('/tools/reorder') && method === 'PUT') {
      const order = body().order || [];
      state.reorderCalls.push(order);
      order.forEach((id, i) => {
        const t = state.tools.find((x) => x.id === id);
        if (t) t.sort_order = i + 1;
      });
      return json({ ok: true, count: order.length });
    }
    const toolMatch = path.match(/\/tools\/([^/]+)$/);
    if (toolMatch && method === 'PUT') {
      const t = state.tools.find((x) => x.id === toolMatch[1]);
      if (!t) return json({ detail: 'Tool not found' }, 404);
      Object.assign(t, body());
      return json({ tool: t });
    }

    // --- stats ---
    if (path.endsWith('/stats/dashboard')) return json(state.dashboard);
    if (path.endsWith('/stats/conversions')) return json({ days: 30, series: state.series });
    if (path.endsWith('/stats/errors')) return json({ errors: state.errors });

    // --- ratings (bulk) ---
    if (path.endsWith('/ratings') && method === 'GET') {
      state.ratingsCalls += 1;
      return json(state.ratings);
    }

    // --- announcements ---
    if (path.endsWith('/announcements') && method === 'GET') {
      return json({ announcements: state.announcements.slice().reverse() });
    }
    if (path.endsWith('/announcements') && method === 'POST') {
      state.lastAnnouncementBody = body();
      const a = Object.assign({ id: ++state._annId, created_at: new Date().toISOString() }, body());
      if (a.active) state.announcements.forEach((x) => (x.active = false));
      state.announcements.push(a);
      return json({ announcement: a });
    }
    const annMatch = path.match(/\/announcements\/(\d+)$/);
    if (annMatch && method === 'PUT') {
      const a = state.announcements.find((x) => x.id === Number(annMatch[1]));
      if (!a) return json({ detail: 'not found' }, 404);
      Object.assign(a, body());
      if (a.active) state.announcements.forEach((x) => (x.id !== a.id ? (x.active = false) : null));
      return json({ announcement: a });
    }
    if (annMatch && method === 'DELETE') {
      state.announcements = state.announcements.filter((x) => x.id !== Number(annMatch[1]));
      return json({ ok: true });
    }

    // --- users ---
    if (path.endsWith('/users') && method === 'GET') return json({ users: state.users });
    if (/\/users\/[^/]+\/history$/.test(path) && method === 'GET') {
      return json({ has_more: false, history: state.userHistory || [] });
    }
    const userMatch = path.match(/\/users\/([^/]+)$/);
    if (userMatch && method === 'GET') {
      const u = state.users.find((x) => x.id === userMatch[1]);
      if (!u) return json({ detail: 'not found' }, 404);
      return json({ user: Object.assign({ favorites: ['img-a'] }, u), history: [] });
    }

    // --- deploy stub (501, exactly like Phase 1) ---
    if (path.includes('/admin/deploy')) {
      state.deployCalls += 1;
      return json({ detail: 'Deploy is configured in Phase 7' }, 501);
    }

    return json({ detail: 'unhandled ' + method + ' ' + path }, 500);
  });
}
