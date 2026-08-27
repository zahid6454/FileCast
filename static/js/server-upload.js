(function () {
  'use strict';

  var config = window.TOOL_CONFIG;
  if (!config || config.type !== 'server-side') return;

  // Normalize once (strip any trailing slash) so `apiBase + '/api/…'` never
  // produces a double slash if the configured base_url ever gains one.
  var apiBase = (config.api_base_url || 'https://api.filecast.org').replace(/\/$/, '');
  // endpoint is always absolute (either the fully-qualified URL the template
  // renders, or built from apiBase here) — a bare relative path in
  // TOOL_CONFIG's JSON got mistaken by Googlebot for a same-origin link and
  // crawled as https://www.filecast.org/api/v1/convert/... (404 noise in GSC).
  var endpoint = config.api_endpoint || apiBase + '/api/v1/convert/' + config.id;

  // Check API health before enabling uploads
  var zone = document.getElementById('upload-zone');
  var convertBtn = document.getElementById('convert-btn');
  var errorMsg = document.getElementById('error-msg');

  function checkHealth() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', apiBase + '/api/v1/health', true);
    xhr.timeout = 5000;
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data.status === 'healthy') return;
        } catch (e) {}
      }
      showServiceError();
    };
    xhr.onerror = function () {
      showServiceError();
    };
    xhr.ontimeout = function () {
      showServiceError();
    };
    xhr.send();
  }

  function showServiceError() {
    if (zone) {
      zone.innerHTML =
        '<div class="upload-zone__text">Conversion service is temporarily unavailable.</div>' +
        '<div class="upload-zone__hint">Please try again in a few minutes.</div>';
      zone.classList.add('upload-zone--disabled');
    }
    if (convertBtn) convertBtn.disabled = true;
  }

  checkHealth();

  // HTML external reference warning
  if (config.id === 'html-to-pdf') {
    window.addEventListener('DOMContentLoaded', function () {
      var fileInput = document.getElementById('file-input');
      if (!fileInput) return;
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var html = reader.result || '';
          var hasExternal =
            /<link[^>]+href\s*=/i.test(html) ||
            /<script[^>]+src\s*=/i.test(html) ||
            /<img[^>]+src\s*=\s*["'](?!data:)/i.test(html);
          var existing = document.getElementById('external-ref-warning');
          if (existing) existing.remove();
          if (hasExternal) {
            var warning = document.createElement('div');
            warning.id = 'external-ref-warning';
            warning.className = 'error-msg error-msg--warning';
            warning.innerHTML =
              'This file references external stylesheets, scripts, or images that ' +
              'won’t be available during conversion. The PDF may look unstyled. ' +
              'For best results, embed your CSS and images directly in the HTML file.';
            var convertAction = document.querySelector('.convert-action');
            if (convertAction) convertAction.parentNode.insertBefore(warning, convertAction);
          }
        };
        reader.readAsText(file.slice(0, 50000));
      });
    });
  }

  // Conversion is now async (Phase 3 — STRESS_TEST_PHASE3_PLAN.md): the
  // upload POST returns 202 + {job_id} the moment validation passes, and
  // this polls GET .../jobs/{id} until the worker resolves it, then fetches
  // the result via GET .../jobs/{id}/download. shared.js doesn't know or
  // care — window.convertFile still returns one Promise<Blob>, so a fast
  // conversion looks identical to the old single-XHR wait.

  // Approximates the same backoff shape the server's own Retry-After header
  // already encodes (converter.py's _job_retry_after_seconds) — used only
  // when a poll response doesn't carry one (e.g. a request that errored out
  // before reaching the status handler). ~1s to start, capped ~5s for the
  // first ~2 minutes, then a longer ~18s tail so a worst-case job doesn't
  // burn through its own rate-limit budget just by polling.
  function fallbackPollDelayMs(elapsedMs) {
    if (elapsedMs < 10000) return 1000;
    if (elapsedMs < 120000) return 5000;
    return 18000;
  }

  function nextPollDelayMs(retryAfterHeader, elapsedMs) {
    var seconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(seconds) && seconds >= 0) return seconds * 1000;
    return fallbackPollDelayMs(elapsedMs);
  }

  // Past this many ms of polling, swap the label to an honest "still
  // working" message instead of leaving a spinner with no explanation — the
  // report's exact wording, no queue position or upfront disclaimer.
  var LONG_WAIT_MESSAGE_AFTER_MS = 8000;

  // Server upload as the conversion function
  window.convertFile = function (file) {
    return new Promise(function (resolve, reject) {
      var activeXhr = null; // whatever request (upload/poll/download) is in flight
      var pollTimer = null; // pending setTimeout for the next poll tick
      var cancelled = false;
      var pollStartTime = null;
      var longWaitShown = false;

      var progressFill = document.getElementById('progress-fill');
      var progressEl = document.getElementById('progress');
      var progressLabel = document.getElementById('progress-label');
      var cancelBtn = document.getElementById('cancel-btn');

      // With a repeating poll loop, aborting only the *current* in-flight
      // request isn't enough — the loop would just schedule another one.
      // The cancelled flag is checked before every scheduled next poll, on
      // top of aborting whatever request (upload/poll/download) is active
      // right now.
      window.cancelConversion = function () {
        if (cancelled) return;
        cancelled = true;
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        if (activeXhr) {
          activeXhr.abort(); // fires that xhr's onabort -> reject('Cancelled.')
          activeXhr = null;
        } else {
          // Between poll ticks — nothing in flight to abort.
          reject(new Error('Cancelled.'));
        }
      };

      // shared.js's own visibility check (startConversion()) runs
      // synchronously, before this Promise executor — which assigns
      // window.cancelConversion — has had a chance to run at all, so it
      // always sees `undefined` and hides the button on a page's first
      // conversion (Phase 3 stress test, Finding 5). Showing it here,
      // right where cancelConversion's lifecycle actually starts, fixes
      // that; shared.js's setState() already re-hides it on every other
      // state transition.
      if (cancelBtn) cancelBtn.classList.remove('hidden');

      function maybeShowLongWaitMessage() {
        if (longWaitShown || !progressLabel) return;
        if (Date.now() - pollStartTime < LONG_WAIT_MESSAGE_AFTER_MS) return;
        longWaitShown = true;
        progressLabel.textContent = 'Still converting — this is taking a bit longer than usual.';
      }

      function scheduleNextPoll(jobId, retryAfterHeader) {
        if (cancelled) return;
        var delay = nextPollDelayMs(retryAfterHeader, Date.now() - pollStartTime);
        pollTimer = setTimeout(function () {
          pollTimer = null;
          poll(jobId);
        }, delay);
      }

      function downloadResult(jobId) {
        if (cancelled) return;
        var xhr = new XMLHttpRequest();
        activeXhr = xhr;
        xhr.open('GET', apiBase + '/api/v1/convert/jobs/' + jobId + '/download', true);
        xhr.withCredentials = true;
        xhr.responseType = 'blob';

        xhr.onload = function () {
          activeXhr = null;
          if (progressFill) progressFill.style.width = '100%';
          if (xhr.status === 200) {
            resolve(xhr.response);
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            try {
              var err = JSON.parse(reader.result);
              reject(new Error(err.error || 'Conversion failed. Please try again.'));
            } catch (e) {
              reject(new Error('Conversion failed. Please try again.'));
            }
          };
          reader.onerror = function () {
            reject(new Error('Conversion failed. Please try again.'));
          };
          reader.readAsText(xhr.response);
        };
        xhr.onerror = function () {
          activeXhr = null;
          reject(new Error('Network error. Check your connection and try again.'));
        };
        xhr.onabort = function () {
          activeXhr = null;
          reject(new Error('Cancelled.'));
        };
        xhr.send();
      }

      function poll(jobId) {
        if (cancelled) return;
        var xhr = new XMLHttpRequest();
        activeXhr = xhr;
        xhr.open('GET', apiBase + '/api/v1/convert/jobs/' + jobId, true);
        xhr.withCredentials = true;
        xhr.responseType = 'json';
        // Bounds only THIS one request, not the overall wait — a failed
        // poll just retries on the next tick rather than aborting the whole
        // flow (there is no fixed client give-up on the flow as a whole;
        // see server-upload.js's history / STRESS_TEST_PHASE3_PLAN.md for
        // why an earlier draft's xhr.timeout-as-give-up was wrong: it would
        // silently discard a job that's still genuinely converting).
        xhr.timeout = 10000;

        xhr.onload = function () {
          activeXhr = null;
          if (cancelled) return;
          var retryAfter = xhr.getResponseHeader('Retry-After');
          var body = xhr.response;
          if (xhr.status !== 200 || !body) {
            scheduleNextPoll(jobId, retryAfter);
            return;
          }
          if (body.status === 'done') {
            downloadResult(jobId);
          } else if (body.status === 'failed') {
            reject(new Error(body.error || 'Conversion failed. Please try again.'));
          } else {
            maybeShowLongWaitMessage();
            scheduleNextPoll(jobId, retryAfter);
          }
        };
        xhr.onerror = function () {
          activeXhr = null;
          if (cancelled) return;
          scheduleNextPoll(jobId, null);
        };
        xhr.ontimeout = function () {
          activeXhr = null;
          if (cancelled) return;
          scheduleNextPoll(jobId, null);
        };
        xhr.onabort = function () {
          activeXhr = null;
          reject(new Error('Cancelled.'));
        };
        xhr.send();
      }

      var formData = new FormData();
      formData.append('file', file);

      // Append tool-specific options
      if (config.id === 'pdf-compress') {
        var qualityEl = document.getElementById('opt-quality');
        if (qualityEl) formData.append('quality', qualityEl.value);
      }

      var xhr = new XMLHttpRequest();
      activeXhr = xhr;
      xhr.open('POST', endpoint, true);
      // Send the session cookie so the server can grant a signed-in user the
      // doubled size limit (§6.3). FormData keeps this a "simple" CORS request,
      // so credentials add no preflight; anonymous users just send no cookie.
      xhr.withCredentials = true;
      xhr.responseType = 'json';
      // Bounds the upload itself (network transfer + the server's
      // synchronous validation, both fast) — not conversion time, which no
      // longer happens on this connection at all.
      xhr.timeout = 120000;

      // Upload progress — drive the progress bar directly
      if (xhr.upload && progressFill && progressEl) {
        progressEl.classList.remove('progress--indeterminate');
        if (progressLabel) progressLabel.textContent = 'Uploading…';
        xhr.upload.addEventListener('progress', function (e) {
          if (e.lengthComputable) {
            var pct = Math.round((e.loaded / e.total) * 90);
            progressFill.style.width = pct + '%';
          }
        });
        // Upload finished (all bytes sent); what's pending now is the job
        // being picked up and converted, not more network I/O on this
        // connection (P3 §27 — the "Processing..." spinner state).
        xhr.upload.addEventListener('load', function () {
          progressFill.style.width = '90%';
          if (progressLabel) progressLabel.textContent = 'Processing…';
        });
      }

      xhr.onload = function () {
        activeXhr = null;
        if (cancelled) return;

        if (xhr.status === 202) {
          var body = xhr.response;
          var jobId = body && body.job_id;
          if (!jobId) {
            reject(new Error('Conversion failed. Please try again.'));
            return;
          }
          pollStartTime = Date.now();
          poll(jobId);
          return;
        }

        if (xhr.status === 429) {
          reject(new Error('Rate limit exceeded. Please wait a few minutes and try again.'));
          return;
        }

        var errBody = xhr.response;
        reject(new Error((errBody && errBody.error) || 'Conversion failed. Please try again.'));
      };

      xhr.onerror = function () {
        activeXhr = null;
        reject(new Error('Network error. Check your connection and try again.'));
      };

      xhr.ontimeout = function () {
        activeXhr = null;
        reject(new Error('Upload timed out. Try a smaller file or check your connection.'));
      };

      xhr.onabort = function () {
        activeXhr = null;
        reject(new Error('Cancelled.'));
      };

      xhr.send(formData);
    });
  };
})();
