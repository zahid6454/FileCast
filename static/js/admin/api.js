// The one fetch seam for the admin SPA (Phase 4 §4.3).
//
// Every call:
//   - URL = window.FILECAST.apiBase + path (path always begins '/api/v1/…',
//     except the unauthenticated root-env probe api.get('/') in app.js's
//     renderSignIn(), which deliberately hits the bare API root instead).
//   - credentials:'include' (cookie-based sessions; CORS allows credentials).
//   - JSON bodies set Content-Type: application/json (the only header Phase 1's
//     CORS allows — F5/R2).
//
// Central status handling so every caller is consistent (R5/R8):
//   - 2xx           → resolve parsed JSON (or null on 204).
//   - 401 / 403     → reject with a tagged AuthError; app.js catches it globally
//                     and drops to the sign-in gate (session expiry OR live
//                     demotion mid-session — role is never cached, D6).
//   - 501           → resolve the sentinel { notImplemented:true } (used ONLY by
//                     the deploy call, §7); callers never treat it as failure.
//   - other non-2xx → reject with an ApiError { status, message } (message from
//                     the parsed body when present) → surfaced as a toast.
(function () {
  'use strict';
  var ADMIN = (window.ADMIN = window.ADMIN || {});

  function AuthError(status) {
    this.name = 'AuthError';
    this.status = status;
    this.isAuthError = true;
    this.message = 'Authentication required';
  }
  AuthError.prototype = Object.create(Error.prototype);

  function ApiError(status, message) {
    this.name = 'ApiError';
    this.status = status;
    this.message = message || 'Request failed';
  }
  ApiError.prototype = Object.create(Error.prototype);

  function apiBase() {
    return (window.FILECAST && window.FILECAST.apiBase) || '';
  }

  // Best-effort parse of a JSON body; returns null on empty/invalid.
  function parseBody(response) {
    return response.text().then(function (raw) {
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    });
  }

  function request(method, path, body) {
    var opts = {
      method: method,
      credentials: 'include',
      headers: {}
    };
    if (body !== undefined && body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(apiBase() + path, opts).then(function (response) {
      if (response.status === 501) {
        // Deploy stub — resolve a sentinel, never a rejection (§7/R5).
        return { notImplemented: true };
      }
      if (response.status === 401 || response.status === 403) {
        throw new AuthError(response.status);
      }
      if (response.status === 204) return null;
      return parseBody(response).then(function (data) {
        if (response.ok) return data;
        var message =
          (data && (data.detail || data.message)) || 'Request failed (' + response.status + ')';
        throw new ApiError(response.status, message);
      });
    });
  }

  ADMIN.api = {
    request: request,
    get: function (path) {
      return request('GET', path);
    },
    post: function (path, body) {
      return request('POST', path, body);
    },
    put: function (path, body) {
      return request('PUT', path, body);
    },
    del: function (path) {
      return request('DELETE', path);
    },
    AuthError: AuthError,
    ApiError: ApiError,
    isAuthError: function (err) {
      return !!(err && err.isAuthError);
    }
  };
})();
