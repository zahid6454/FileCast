(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State machine: empty → selected → converting → complete (error from any)
  // ---------------------------------------------------------------------------
  var state = 'empty';
  var currentFile = null;
  var convertedBlob = null;
  var convertedFilename = '';

  // DOM refs (populated in init)
  var els = {};

  // ---------------------------------------------------------------------------
  // Utilities — defined once in fc-util.js (loaded before this file) and aliased
  // here so the call sites below stay unchanged.
  // ---------------------------------------------------------------------------
  var FC = window.FC || {};
  var formatBytes = FC.formatBytes;
  var trackEvent = FC.trackEvent;
  var postConversion = FC.postConversion;
  var getExtension = FC.getExtension;
  var generateOutputFilename = FC.generateOutputFilename;

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  function validateFile(file) {
    var config = window.TOOL_CONFIG;
    if (!config)
      return { valid: false, error: 'Tool configuration not found.', error_type: 'missing_config' };

    var ext = getExtension(file.name);
    if (!config.accept_extensions.includes(ext)) {
      return {
        valid: false,
        error_type: 'wrong_format',
        error:
          'This tool accepts ' +
          config.accept_extensions.join(', ') +
          ' files. You selected a ' +
          (ext || 'unknown') +
          ' file.'
      };
    }

    if (file.size > config.max_file_size_bytes) {
      return {
        valid: false,
        error_type: 'too_large',
        error: 'File is too large. Maximum size: ' + config.max_file_size + '.'
      };
    }

    if (file.size === 0) {
      return { valid: false, error_type: 'empty_file', error: 'File is empty.' };
    }

    return { valid: true };
  }

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------
  // Conversion status live region (§6, P2 #17) — a screen reader announces
  // these without the user needing to navigate to the progress/result area.
  // #a11y-status is permanently in the DOM (never itself hidden), so writing
  // its text is what triggers the announcement, not a visibility change.
  function announceState(newState) {
    if (!els.status) return;
    if (newState === 'converting') {
      els.status.textContent = 'Converting your file…';
    } else if (newState === 'complete') {
      els.status.textContent = 'Conversion complete. Download ready.';
    } else {
      els.status.textContent = '';
    }
  }

  function setState(newState) {
    state = newState;

    var isToolPage = !!window.TOOL_CONFIG;
    if (!isToolPage) return;

    els.uploadZone.classList.toggle('hidden', newState !== 'empty');
    els.fileInfo.classList.toggle('hidden', newState === 'empty');
    els.convertBtn.classList.toggle('hidden', newState === 'converting' || newState === 'complete');
    els.progress.classList.toggle('hidden', newState !== 'converting');
    if (els.progressLabel) {
      els.progressLabel.classList.toggle('hidden', newState !== 'converting');
      if (newState !== 'converting') els.progressLabel.textContent = '';
    }
    els.result.classList.toggle('hidden', newState !== 'complete');
    els.errorMsg.classList.add('hidden');
    announceState(newState);

    if (newState === 'empty') {
      els.convertBtn.disabled = true;
    } else if (newState === 'selected') {
      els.convertBtn.disabled = false;
    } else if (newState === 'converting') {
      els.convertBtn.disabled = true;
    }
  }

  // ---------------------------------------------------------------------------
  // File selection
  // ---------------------------------------------------------------------------
  function onFileSelected(file) {
    var result = validateFile(file);
    if (!result.valid) {
      showError(result.error);
      trackEvent('conversion_failed', {
        tool_id: window.TOOL_CONFIG.id,
        error_type: result.error_type
      });
      return;
    }

    currentFile = file;

    els.fileName.textContent = file.name;
    els.fileSize.textContent = formatBytes(file.size);

    // Image thumbnail preview (only for formats the browser can render)
    var preview = els.filePreview;
    if (file.type && file.type.startsWith('image/') && !file.type.match(/heic|heif/i)) {
      var url = URL.createObjectURL(file);
      preview.onload = function () {
        URL.revokeObjectURL(url);
      };
      preview.onerror = function () {
        URL.revokeObjectURL(url);
        preview.classList.add('hidden');
      };
      preview.src = url;
      preview.classList.remove('hidden');
    } else {
      preview.classList.add('hidden');
    }

    setState('selected');
  }

  // ---------------------------------------------------------------------------
  // Upload zone (drag-drop, click-to-browse, mobile)
  // ---------------------------------------------------------------------------
  function initUploadZone() {
    var zone = els.uploadZone;
    var input = els.fileInput;

    zone.addEventListener('click', function () {
      input.click();
    });

    input.addEventListener('change', function () {
      if (input.files && input.files[0]) {
        onFileSelected(input.files[0]);
      }
    });

    // Drag-drop
    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      zone.classList.add('upload-zone--active');
    });
    zone.addEventListener('dragleave', function (e) {
      e.preventDefault();
      zone.classList.remove('upload-zone--active');
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('upload-zone--active');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        onFileSelected(e.dataTransfer.files[0]);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Conversion
  // ---------------------------------------------------------------------------
  function startConversion() {
    if (state !== 'selected' || !currentFile) return;
    if (typeof window.convertFile !== 'function') {
      showError('Converter not loaded. Please refresh the page.');
      return;
    }

    setState('converting');

    // A converter that renders its own multi-output result UI (e.g. per-page
    // downloads for a multi-page PDF) sets this so the single-file result panel
    // below doesn't overwrite its accurate summary. Reset on every run.
    window._converterOwnsResult = false;

    var config = window.TOOL_CONFIG;
    var startTime = Date.now();

    trackEvent('conversion_started', {
      tool_id: config.id,
      input_format: config.input_format,
      output_format: config.output_format,
      file_size_bytes: currentFile.size
    });
    FC.setSentryContext({
      tool_id: config.id,
      input_format: config.input_format,
      output_format: config.output_format,
      file_size_bytes: currentFile.size,
      mode: config.type === 'server-side' ? 'Cloud' : 'Local'
    });

    // Progress: if converter provides a progress callback, use real progress.
    // Default label is 'Processing…' — right for both the indeterminate case
    // below and local converters with real progress (there's no separate
    // upload phase to name). server-upload.js overrides this to 'Uploading…'
    // for cloud tools the moment it wires up real upload-progress tracking,
    // then flips it back to 'Processing…' once the upload itself finishes
    // and the response is what's pending (P3 §27).
    var hasProgress = typeof window.convertProgress === 'function';
    if (els.progressLabel) els.progressLabel.textContent = 'Processing…';
    if (hasProgress) {
      els.progress.classList.remove('progress--indeterminate');
      window.convertProgress(function (pct) {
        els.progressFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
      });
    } else {
      els.progress.classList.add('progress--indeterminate');
      els.progressFill.style.width = '';
    }

    Promise.resolve()
      .then(function () {
        return window.convertFile(currentFile);
      })
      .then(function (blob) {
        var durationMs = Date.now() - startTime;
        var savingsPct =
          currentFile.size > 0 ? Math.round((1 - blob.size / currentFile.size) * 100) : 0;
        // If the converter already rendered its own result UI (multi-page
        // output), just mark complete — overwriting #result-info here would
        // replace its accurate page summary with a page-1-only size stat.
        if (window._converterOwnsResult) {
          setState('complete');
        } else {
          showResult(currentFile, blob, durationMs);
        }
        trackEvent('conversion_completed', {
          tool_id: config.id,
          input_format: config.input_format,
          output_format: config.output_format,
          duration_ms: durationMs,
          file_size_bytes: currentFile.size,
          output_size_bytes: blob.size,
          savings_percent: savingsPct
        });
        postConversion(
          {
            tool_id: config.id,
            input_format: config.input_format,
            output_format: config.output_format,
            file_size_kb: FC.sizeKb(currentFile.size),
            duration_ms: durationMs,
            status: 'success'
          },
          true
        );
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : 'Conversion failed. Please try again.';
        showError(msg);
        trackEvent('conversion_failed', {
          tool_id: config.id,
          error_type: 'conversion_error'
        });
        postConversion(
          {
            tool_id: config.id,
            input_format: config.input_format,
            output_format: config.output_format,
            status: 'failed'
          },
          false
        );
      });
  }

  // ---------------------------------------------------------------------------
  // Result display
  // ---------------------------------------------------------------------------
  function showResult(originalFile, blob, durationMs) {
    convertedBlob = blob;
    convertedFilename = generateOutputFilename(
      originalFile.name,
      window.TOOL_CONFIG.output_extension
    );

    var originalSize = originalFile.size;
    var convertedSize = blob.size;
    var savings = originalSize > 0 ? Math.round((1 - convertedSize / originalSize) * 100) : 0;

    var info = 'Original: ' + formatBytes(originalSize);
    info += '  &rarr;  Converted: ' + formatBytes(convertedSize);
    if (savings > 0) {
      info += '  (' + savings + '% smaller)';
    } else if (savings < 0) {
      info += '  (' + Math.abs(savings) + '% larger)';
    }

    els.resultInfo.innerHTML = info;
    setState('complete');
  }

  // ---------------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------------
  function downloadFile() {
    if (!convertedBlob) return;

    var url = URL.createObjectURL(convertedBlob);
    var a = document.createElement('a');
    a.href = url;
    a.download = convertedFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    trackEvent('file_downloaded', {
      tool_id: window.TOOL_CONFIG.id,
      output_format: window.TOOL_CONFIG.output_format,
      output_size_bytes: convertedBlob.size
    });
  }

  // ---------------------------------------------------------------------------
  // Reset ("Convert Another")
  // ---------------------------------------------------------------------------
  function resetUI() {
    currentFile = null;
    convertedBlob = null;
    convertedFilename = '';

    els.fileInput.value = '';
    els.progressFill.style.width = '0%';
    els.progress.classList.remove('progress--indeterminate');
    els.filePreview.classList.add('hidden');
    els.filePreview.src = '';

    setState('empty');

    trackEvent('convert_another', {
      tool_id: window.TOOL_CONFIG.id
    });
  }

  // ---------------------------------------------------------------------------
  // Error display
  // ---------------------------------------------------------------------------
  function showError(message) {
    els.progress.classList.add('hidden');
    if (state === 'converting') {
      setState('selected');
    }
    els.errorMsg.textContent = message;
    els.errorMsg.classList.remove('hidden');
    if (els.status) els.status.textContent = message;
  }

  // ---------------------------------------------------------------------------
  // Rating widget (persisted yes/no votes; server-side dedup; baked aggregate)
  //
  // The vote POSTs {tool_id, vote} and NOTHING else — the dedup key is a salted
  // IP hash computed server-side, never a client fingerprint (D4/P3). The score
  // is baked into #tool-ratings at build time, so there is no API call on load;
  // after a vote we update optimistically rather than re-fetching (the number is
  // stale-by-design until the next deploy).
  // ---------------------------------------------------------------------------
  var RATING_THRESHOLD = 50; // show the % line only at 50+ total ratings

  function parseBakedRating() {
    var el = document.getElementById('tool-ratings');
    if (!el) return null; // no DB at build / unseeded tool -> default prompt
    try {
      var d = JSON.parse(el.textContent);
      // Number(x) || 0 (not |0, which 32-bit-truncates) so null/undefined/string
      // counts degrade to 0 instead of NaN-poisoning the arithmetic.
      return { yes: Number(d.yes) || 0, no: Number(d.no) || 0 };
    } catch (e) {
      return null;
    }
  }

  function ratingKey() {
    var config = window.TOOL_CONFIG;
    return config ? 'fc_rated_' + config.id : null;
  }

  // Returns the recorded vote ('yes'/'no'), a legacy truthy value, or null.
  function votedLocally() {
    var key = ratingKey();
    try {
      return key ? window.localStorage.getItem(key) : null;
    } catch (e) {
      return null; // privacy mode / storage disabled
    }
  }

  // Stores the DIRECTION, not a flag, so the reload path can reproduce the same
  // count the vote path showed (see initFeedback).
  function markVotedLocally(vote) {
    var key = ratingKey();
    try {
      if (key) window.localStorage.setItem(key, vote);
    } catch (e) {
      /* storage disabled — the server dedup is the real one anyway */
    }
  }

  // "X% helpful (N ratings)" at/above the threshold, else null. The single home
  // of the threshold + percentage maths, reused for both the pre-vote
  // social-proof line and the post-vote resolve.
  //
  // The wording describes the RATINGS RECORDED, not the people behind them, and
  // that distinction is deliberate. The count is conservative and can undercount
  // real voters: the server dedup key is
  // sha256(daily_salt : client_ip : tool_id) upserted under
  // UNIQUE(tool_id, fingerprint), so everyone sharing an egress IP (carrier
  // CGNAT, an office, a VPN exit) collapses to one row per tool per day, and a
  // later voter overwrites an earlier one. N is therefore a count of stored
  // rows — literally accurate — while "N people found this helpful" would not
  // be. That skew is the privacy-preserving trade (no client fingerprinting,
  // D4/P3); the error direction is always under-, never over-counting. See
  // api/data/fingerprint.py.
  function scoreLine(agg) {
    if (!agg) return null;
    var total = agg.yes + agg.no;
    if (total < RATING_THRESHOLD) return null;
    var pct = Math.round((agg.yes / total) * 100);
    return pct + '% helpful (' + total + ' ratings)';
  }

  // Unhide BEFORE writing the text, not after. `.hidden` is display:none, which
  // keeps the element out of the accessibility tree — a live region mutated
  // while hidden announces nothing, so the reverse order would silently defeat
  // the role="status" on #feedback-score (R11).
  function showScore(scoreEl, text) {
    scoreEl.classList.remove('hidden');
    scoreEl.textContent = text; // safe DOM: never innerHTML with data (P23)
  }

  // Baked counts plus this vote — the recorded vote is not in the baked data
  // until the next deploy, so add it back.
  function withVote(baked, vote) {
    var agg = { yes: baked ? baked.yes : 0, no: baked ? baked.no : 0 };
    agg[vote] += 1;
    return agg;
  }

  // Collapse to the resolved display: score line at 50+, else a plain thanks.
  // `target` decides whether the message is ANNOUNCED: the vote path passes the
  // live #feedback-score, the page-load path passes the inert #feedback-baked.
  function resolveWidget(agg, prompt, buttons, target) {
    if (prompt) prompt.classList.add('hidden');
    buttons.forEach(function (b) {
      b.classList.add('hidden');
    });
    showScore(target, scoreLine(agg) || 'Thanks for your feedback!');
  }

  function onVote(vote, baked, els) {
    var config = window.TOOL_CONFIG;
    if (config) {
      trackEvent('feedback_submitted', { tool_id: config.id, response: vote });
    }

    // Read the API origin at click time, so there is no script-load-order
    // dependency on the FILECAST config island.
    var apiBase = window.FILECAST && window.FILECAST.apiBase;
    if (apiBase && config) {
      fetch(apiBase.replace(/\/$/, '') + '/api/v1/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // a signed-in vote carries user_id; never gates
        body: JSON.stringify({ tool_id: config.id, vote: vote })
      })
        .then(function (r) {
          // Lock ONLY once the server has actually recorded the vote. A network
          // failure (API down, or the origin blocked by an ad-blocker — and
          // Brave/uBlock/Tor users are exactly our users) or a 429/4xx means
          // nothing was persisted; locking anyway would discard that person's
          // feedback on this tool permanently, and would do it disproportionately
          // to the privacy-tooling population, biasing the published percentage.
          if (r && r.ok) markVotedLocally(vote);
        })
        .catch(function () {
          /* silent — API down means voting no-ops (progressive enhancement) */
        });
    }

    // Resolve optimistically regardless: the UX is identical on the happy path,
    // and a vote that never reached the server simply stays retryable.
    if (els.baked) els.baked.classList.add('hidden');
    resolveWidget(withVote(baked, vote), els.prompt, els.buttons, els.score);

    // "No" follow-up (report §11.5, P2 §18) — reveal AFTER resolveWidget, not
    // instead of it: the yes/no state transition is unchanged (buttons hide,
    // score/thanks shows), this is purely additive. Focus moves into the
    // textarea so a keyboard user lands straight in it rather than needing to
    // tab past the now-hidden buttons to find it.
    if (vote === 'no' && els.detail) {
      els.detail.classList.remove('hidden');
      if (els.detailText) els.detailText.focus();
    }
  }

  // Auto-grow the "what went wrong?" textarea (report §11.5's exact spec) and
  // wire its Submit button. `.style.height` is a JS-driven inline style
  // attribute — CSP-allowed via style-src-attr 'unsafe-inline' (P2 §14), NOT
  // the element-level style-src (which is what closed the actual CSS
  // injection vector this same effort fixed).
  function initFeedbackDetail(els) {
    if (!els.detailText || !els.detailSubmit) return;

    els.detailText.addEventListener('input', function () {
      els.detailText.style.height = 'auto';
      els.detailText.style.height = els.detailText.scrollHeight + 'px';
    });

    els.detailSubmit.addEventListener('click', function () {
      var config = window.TOOL_CONFIG;
      var text = els.detailText.value.trim();
      if (!text || !config) return; // nothing typed — silently no-op

      var apiBase = window.FILECAST && window.FILECAST.apiBase;
      if (apiBase) {
        fetch(apiBase.replace(/\/$/, '') + '/api/v1/ratings/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool_id: config.id, feedback_text: text })
        }).catch(function () {
          /* silent — same progressive-enhancement posture as the vote POST */
        });
      }

      // Resolve optimistically regardless of network outcome, same rationale
      // as the vote itself (§6/onVote): the textarea+button are replaced with
      // a thank-you whether or not the request actually lands.
      els.detailText.classList.add('hidden');
      els.detailSubmit.classList.add('hidden');
      if (els.detailLabel) els.detailLabel.classList.add('hidden');
      if (els.detailThanks) els.detailThanks.classList.remove('hidden');
    });
  }

  // Wire the Yes/No buttons via delegation — no inline on* handlers, so the site
  // CSP can stay 'script-src self' (no unsafe-inline).
  function initFeedback() {
    var feedback = document.getElementById('feedback');
    if (!feedback) return; // no-op on non-tool pages
    var els = {
      buttons: feedback.querySelectorAll('[data-feedback]'),
      prompt: document.getElementById('feedback-prompt'),
      score: document.getElementById('feedback-score'), // live: vote confirmation
      baked: document.getElementById('feedback-baked'), // inert: page-load text
      detail: document.getElementById('feedback-detail'),
      detailLabel: feedback.querySelector('.feedback__detail-label'),
      detailText: document.getElementById('feedback-text'),
      detailSubmit: document.getElementById('feedback-submit'),
      detailThanks: document.getElementById('feedback-detail-thanks')
    };
    // Both score elements are part of the markup contract. Requiring them keeps
    // a partial template inert (obvious in testing) rather than quietly routing
    // load-time text through the live region (invisible to everyone sighted).
    if (!els.buttons.length || !els.score || !els.baked) return;

    initFeedbackDetail(els);

    var baked = parseBakedRating();

    // NOTHING on this path may write to the live region: it runs at
    // DOMContentLoaded, so a screen reader would interrupt whatever the user is
    // doing to read out text they never asked for, on every single page load.
    var voted = votedLocally();
    if (voted) {
      // Mirror what the vote itself displayed. A legacy flag lock has no
      // direction to restore, so it falls back to the bare baked counts.
      var seen = voted === 'yes' || voted === 'no' ? withVote(baked, voted) : baked;
      resolveWidget(seen, els.prompt, els.buttons, els.baked);
      return;
    }

    var line = scoreLine(baked); // pre-vote social proof at 50+; buttons stay
    if (line) showScore(els.baked, line);

    els.buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var vote = btn.dataset.feedback;
        if (vote !== 'yes' && vote !== 'no') return; // malformed attribute
        onVote(vote, baked, els);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Category page search
  // ---------------------------------------------------------------------------
  function initSearch() {
    var searchInput = document.getElementById('tool-search');
    if (!searchInput) return;

    var cards = document.querySelectorAll('.card[data-name]');
    var noResults = document.getElementById('no-results');

    searchInput.addEventListener('input', function () {
      var query = searchInput.value.toLowerCase().trim();

      if (!query) {
        cards.forEach(function (card) {
          card.classList.remove('hidden');
        });
        if (noResults) noResults.classList.add('hidden');
        return;
      }

      trackSearchDebounced(query);

      var matchCount = 0;
      cards.forEach(function (card) {
        var name = card.getAttribute('data-name') || '';
        var match = name.includes(query);
        card.classList.toggle('hidden', !match);
        if (match) matchCount++;
      });

      if (noResults) noResults.classList.toggle('hidden', matchCount > 0);
    });
  }

  // Debounced search tracking (fire after 500ms of no typing)
  var searchTimer = null;
  function trackSearchDebounced(query) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      trackEvent('search_used', { search_query: query });
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // Tool option sliders (F4): bind the range read-out without an inline handler.
  // Runs on BOTH tool.html (standard) and tool-multi.html (ui_type: multi), so
  // it must be called among the UNCONDITIONAL inits, before the standard-only
  // early returns below. Replaces the old inline `oninput` that a strict
  // `script-src 'self'` CSP would block. No-op where no slider exists.
  // ---------------------------------------------------------------------------
  function initToolOptions() {
    var sliders = document.querySelectorAll('.tool-options__slider');
    if (!sliders.length) return;
    sliders.forEach(function (slider) {
      var targetId = slider.getAttribute('data-value-target');
      if (!targetId) return;
      var target = document.getElementById(targetId);
      if (!target) return;
      var suffix = slider.getAttribute('data-suffix') || '';
      slider.addEventListener('input', function () {
        target.textContent = slider.value + suffix;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Related tool click tracking
  // ---------------------------------------------------------------------------
  function initRelatedToolTracking() {
    document.addEventListener('click', function (e) {
      var card = e.target.closest('.card[data-source][data-target]');
      if (card) {
        trackEvent('related_tool_clicked', {
          source_tool_id: card.getAttribute('data-source'),
          target_tool_id: card.getAttribute('data-target')
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  function init() {
    // Homepage search (runs on homepage)
    initSearch();

    // Tool option sliders (F4 fix) — must run before the standard-only guard
    // so multi-file tool sliders (a non-standard ui_type) still bind.
    initToolOptions();

    // Related tool click tracking (runs on tool pages)
    initRelatedToolTracking();

    // Feedback Yes/No buttons (all tool page types, before the standard-only guard)
    initFeedback();

    // Tool page initialization
    if (!window.TOOL_CONFIG) return;
    var uiType = window.TOOL_CONFIG.ui_type || 'standard';
    if (uiType !== 'standard') return;

    els.uploadZone = document.getElementById('upload-zone');
    els.fileInput = document.getElementById('file-input');
    els.fileInfo = document.getElementById('file-info');
    els.filePreview = document.getElementById('file-preview');
    els.fileName = document.getElementById('file-name');
    els.fileSize = document.getElementById('file-size');
    els.convertBtn = document.getElementById('convert-btn');
    els.progress = document.getElementById('progress');
    els.progressFill = document.getElementById('progress-fill');
    els.progressLabel = document.getElementById('progress-label');
    els.result = document.getElementById('result');
    els.resultInfo = document.getElementById('result-info');
    els.downloadBtn = document.getElementById('download-btn');
    els.resetBtn = document.getElementById('reset-btn');
    els.errorMsg = document.getElementById('error-msg');
    els.status = document.getElementById('a11y-status');

    initUploadZone();

    els.convertBtn.addEventListener('click', startConversion);
    els.downloadBtn.addEventListener('click', downloadFile);
    els.resetBtn.addEventListener('click', resetUI);

    // Fire tool_view event
    trackEvent('tool_view', {
      tool_id: window.TOOL_CONFIG.id,
      tool_category: window.TOOL_CONFIG.category || '',
      tool_type: window.TOOL_CONFIG.type
    });
  }

  // Run when DOM is ready (script is loaded with defer, so DOMContentLoaded is safe)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
