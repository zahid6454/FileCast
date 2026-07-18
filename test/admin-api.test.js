import { describe, expect, it } from 'vitest';
import { createDom, evalScript, flush } from './helpers.js';

// api.js is the single fetch seam; its status normalization (401/403 → AuthError,
// 501 → { notImplemented } sentinel, other non-2xx → ApiError) is what keeps the
// deploy stub from ever surfacing as a save error and what routes expiry/demotion
// back to the gate. We stub window.fetch and assert each branch.
function makeResponse(status, bodyText) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(bodyText === undefined ? '' : bodyText)
  });
}

function loadApi(fetchImpl) {
  const dom = createDom();
  dom.window.FILECAST = { apiBase: 'https://api.test' };
  dom.window.fetch = fetchImpl;
  evalScript(dom, 'admin/dom.js');
  evalScript(dom, 'admin/api.js');
  return dom.window.ADMIN.api;
}

describe('admin/api.js — status normalization', () => {
  it('resolves parsed JSON on 200', async () => {
    const api = loadApi(() => makeResponse(200, '{"tools":[1,2]}'));
    await expect(api.get('/api/v1/tools')).resolves.toEqual({ tools: [1, 2] });
  });

  it('resolves null on 204', async () => {
    const api = loadApi(() => makeResponse(204));
    await expect(api.del('/api/v1/x/1')).resolves.toBeNull();
  });

  it('maps 501 to the { notImplemented:true } sentinel (never a rejection)', async () => {
    const api = loadApi(() => makeResponse(501, '{"detail":"Deploy is Phase 7"}'));
    await expect(api.post('/api/v1/admin/deploy', {})).resolves.toEqual({
      notImplemented: true
    });
  });

  it('rejects 401 with a tagged AuthError', async () => {
    const api = loadApi(() => makeResponse(401, ''));
    await api.get('/api/v1/auth/me').then(
      () => {
        throw new Error('should have rejected');
      },
      (err) => {
        expect(err.isAuthError).toBe(true);
        expect(err.status).toBe(401);
      }
    );
  });

  it('rejects 403 with a tagged AuthError', async () => {
    const api = loadApi(() => makeResponse(403, ''));
    await api.get('/api/v1/tools').then(
      () => {
        throw new Error('should have rejected');
      },
      (err) => expect(err.isAuthError).toBe(true)
    );
  });

  it('rejects other non-2xx with an ApiError carrying the body detail', async () => {
    const api = loadApi(() => makeResponse(500, '{"detail":"boom"}'));
    await api.get('/api/v1/stats/dashboard').then(
      () => {
        throw new Error('should have rejected');
      },
      (err) => {
        expect(err.isAuthError).toBeFalsy();
        expect(err.status).toBe(500);
        expect(err.message).toBe('boom');
      }
    );
  });

  it('sends JSON bodies with a Content-Type header and credentials', async () => {
    let captured = null;
    const api = loadApi((url, opts) => {
      captured = { url, opts };
      return makeResponse(200, '{"ok":true}');
    });
    await api.put('/api/v1/tools/reorder', { order: ['a', 'b'] });
    await flush();
    expect(captured.url).toBe('https://api.test/api/v1/tools/reorder');
    expect(captured.opts.method).toBe('PUT');
    expect(captured.opts.credentials).toBe('include');
    expect(captured.opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(captured.opts.body)).toEqual({ order: ['a', 'b'] });
  });
});
