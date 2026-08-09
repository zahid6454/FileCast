(function () {
  'use strict';

  var config = window.TOOL_CONFIG;
  if (!config || config.type !== 'server-side') return;

  // Normalize once (strip any trailing slash) so `apiBase + '/api/…'` never
  // produces a double slash if the configured base_url ever gains one.
  var apiBase = (config.api_base_url || 'https://api.filecast.org').replace(/\/$/, '');
  var endpoint = config.api_endpoint || '/api/v1/convert/' + config.id;

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

  // Server upload as the conversion function
  window.convertFile = function (file) {
    return new Promise(function (resolve, reject) {
      var formData = new FormData();
      formData.append('file', file);

      // Append tool-specific options
      if (config.id === 'pdf-compress') {
        var qualityEl = document.getElementById('opt-quality');
        if (qualityEl) formData.append('quality', qualityEl.value);
      }

      var xhr = new XMLHttpRequest();
      xhr.open('POST', apiBase + endpoint, true);
      // Send the session cookie so the server can grant a signed-in user the
      // doubled size limit (§6.3). FormData keeps this a "simple" CORS request,
      // so credentials add no preflight; anonymous users just send no cookie.
      xhr.withCredentials = true;
      xhr.responseType = 'blob';
      xhr.timeout = 120000;

      // Upload progress — drive the progress bar directly
      var progressFill = document.getElementById('progress-fill');
      var progressEl = document.getElementById('progress');
      var progressLabel = document.getElementById('progress-label');
      if (xhr.upload && progressFill && progressEl) {
        progressEl.classList.remove('progress--indeterminate');
        if (progressLabel) progressLabel.textContent = 'Uploading…';
        xhr.upload.addEventListener('progress', function (e) {
          if (e.lengthComputable) {
            var pct = Math.round((e.loaded / e.total) * 90);
            progressFill.style.width = pct + '%';
          }
        });
        // Upload finished (all bytes sent); what's pending now is Gotenberg/
        // Ghostscript actually converting the file, not more network I/O
        // (P3 §27 — the "Processing..." spinner state the report asked for).
        xhr.upload.addEventListener('load', function () {
          progressFill.style.width = '90%';
          if (progressLabel) progressLabel.textContent = 'Processing…';
        });
      }

      xhr.onload = function () {
        if (progressFill) progressFill.style.width = '100%';

        if (xhr.status === 200) {
          resolve(xhr.response);
        } else if (xhr.status === 429) {
          reject(new Error('Rate limit exceeded. Please wait a few minutes and try again.'));
        } else {
          // Try to parse error JSON from blob
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
        }
      };

      xhr.onerror = function () {
        reject(new Error('Network error. Check your connection and try again.'));
      };

      xhr.ontimeout = function () {
        reject(new Error('Conversion timed out. Try a simpler or smaller file.'));
      };

      xhr.send(formData);
    });
  };
})();
