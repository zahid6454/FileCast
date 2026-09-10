(function () {
  'use strict';

  var state = 'empty';
  var els = {};

  // Shared helpers live in fc-util.js (loaded before this file); see there for
  // the fire-and-forget postConversion tracking contract.
  var FC = window.FC || {};
  var formatBytes = FC.formatBytes;
  var trackEvent = FC.trackEvent;
  var postConversion = FC.postConversion;
  var reportError = FC.reportError;
  // Falls back to a no-op when text-editor-gutter.js isn't loaded (e.g. unit
  // tests that eval this file standalone) rather than assuming it's always present.
  var refreshLineNumbers = FC.refreshLineNumbers || function () {};

  // Conversion status live region (§6, P2 #17) — see shared.js's announceState
  // for the full rationale; same pattern, mirrored per-file (no shared module
  // seam between these three converter scripts).
  function announceState(newState) {
    if (!els.status) return;
    if (newState === 'converting') {
      els.status.textContent = 'Converting…';
    } else if (newState === 'complete') {
      els.status.textContent = 'Conversion complete. Result ready.';
    } else {
      els.status.textContent = '';
    }
  }

  function setState(newState) {
    state = newState;
    els.convertBtn.disabled = newState === 'converting';
    els.progress.classList.toggle('hidden', newState !== 'converting');
    els.errorMsg.classList.add('hidden');
    announceState(newState);
    if (newState === 'complete') {
      els.textResult.classList.remove('hidden');
    } else if (newState === 'empty') {
      els.textResult.classList.add('hidden');
    }
  }

  // A tool with a hard content limit (Barcode Generator: input_max_length
  // chars, QR Code Generator: input_max_bytes) used to only reveal it as a
  // rejection after clicking Convert. Whichever field the tool declares
  // turns that counter into a live "count / max" gauge instead of a plain
  // count, so the limit is visible before the click, not after.
  function clearGauge(el) {
    el.classList.remove('limit-ok', 'limit-warn', 'limit-over');
  }
  function setGauge(el, count, max, unit) {
    el.textContent = count.toLocaleString() + ' / ' + max.toLocaleString() + ' ' + unit;
    clearGauge(el);
    el.classList.add(count > max ? 'limit-over' : count > max * 0.8 ? 'limit-warn' : 'limit-ok');
  }

  function updateMeta() {
    var text = els.inputArea.value;
    var bytes = new Blob([text]).size;
    var config = window.TOOL_CONFIG || {};

    if (config.input_max_length) {
      setGauge(els.charCount, text.length, config.input_max_length, 'chars');
    } else {
      els.charCount.textContent = text.length.toLocaleString() + ' chars';
      clearGauge(els.charCount);
    }

    if (config.input_max_bytes) {
      setGauge(els.byteCount, bytes, config.input_max_bytes, 'Bytes');
    } else {
      els.byteCount.textContent = formatBytes(bytes);
      clearGauge(els.byteCount);
    }
  }

  function validate(text) {
    var config = window.TOOL_CONFIG;
    if (!text.trim()) {
      return {
        valid: false,
        error: 'Please enter or paste some text to convert.',
        error_type: 'empty_input'
      };
    }
    var bytes = new Blob([text]).size;
    if (bytes > config.max_file_size_bytes) {
      return {
        valid: false,
        error: 'Input is too large. Maximum size: ' + config.max_file_size + '.',
        error_type: 'too_large'
      };
    }
    return { valid: true };
  }

  function showError(message) {
    // setState() unconditionally re-hides #error-msg (it's the shared reset
    // for every state transition) — so it MUST run before we reveal the
    // error, not after, or the message we just showed gets hidden again
    // immediately (previously: showError() ran setState('empty') last,
    // which silently re-hid the error a frame after showing it).
    if (state === 'converting') setState('empty');
    els.progress.classList.add('hidden');
    els.errorMsg.textContent = message;
    els.errorMsg.classList.remove('hidden');
    if (els.status) els.status.textContent = message;
  }

  function startConversion() {
    var text = els.inputArea.value;
    var result = validate(text);
    if (!result.valid) {
      showError(result.error);
      trackEvent('conversion_failed', {
        tool_id: window.TOOL_CONFIG.id,
        error_type: result.error_type
      });
      return;
    }

    var config = window.TOOL_CONFIG;
    if (!config.text_converter_src || !config.text_converter_worker_src) {
      showError('Converter is unavailable right now. Please refresh the page.');
      return;
    }

    setState('converting');
    var startTime = Date.now();

    trackEvent('conversion_started', {
      tool_id: config.id,
      input_format: config.input_format,
      output_format: config.output_format,
      file_size_bytes: new Blob([text]).size
    });
    FC.setSentryContext({
      tool_id: config.id,
      input_format: config.input_format,
      output_format: config.output_format,
      file_size_bytes: new Blob([text]).size,
      mode: config.type === 'server-side' ? 'Cloud' : 'Local'
    });

    els.progress.classList.remove('hidden');
    els.progress.classList.add('progress--indeterminate');
    els.progressFill.style.width = '';

    function onFailure(message, errorType) {
      var msg = message || 'Conversion failed. Please check your input and try again.';
      errorType = errorType || 'conversion_error';
      showError(msg);
      trackEvent('conversion_failed', { tool_id: config.id, error_type: errorType });
      postConversion(
        {
          tool_id: config.id,
          input_format: config.input_format,
          output_format: config.output_format,
          status: 'failed'
        },
        false
      );
      reportError({
        tool_id: config.id,
        error_type: errorType,
        error_message: msg,
        browser: navigator.userAgent
      });
    }

    // Off the main thread (mirrors pdf-lib-worker.js's P4 §36 fix) — a
    // multi-MB CSV/JSON/XML input near max_file_size_bytes used to run
    // window.convertText(text) synchronously here and could visibly freeze
    // the tab. The converter's own URL rides the worker's query string
    // (same trick as pdf-lib-worker.js's `lib` param) so one worker file
    // serves every text-input tool.
    var worker = new Worker(
      config.text_converter_worker_src +
        '?converter=' +
        encodeURIComponent(config.text_converter_src)
    );
    worker.onmessage = function (e) {
      worker.terminate();
      var data = e.data || {};
      if (!data.ok) {
        onFailure(data.error, data.errorType);
        return;
      }
      var durationMs = Date.now() - startTime;
      showResult(text, data.result, durationMs);
    };
    worker.onerror = function (err) {
      worker.terminate();
      onFailure(err && err.message);
    };
    worker.postMessage({ text: text });
  }

  function showResult(inputText, output, durationMs) {
    var config = window.TOOL_CONFIG;
    var outputText = output.text;

    els.outputArea.value = outputText;
    // Unhide before refreshing the gutter, not after: #text-result (and the
    // output textarea inside it) starts display:none, and the gutter's
    // matchHeight() reads textarea.offsetHeight — 0 while still hidden. Once
    // per conversion is cheap; getting it backwards left the output gutter
    // pinned to 0 height behind a visible textarea until the next manual
    // resize nudged the ResizeObserver.
    els.textResult.classList.remove('hidden');
    refreshLineNumbers(els.outputArea);
    renderOutputTable(output);

    if (els.imagePreview) {
      // output_is_data_url also covers non-image binary output (CSV to
      // Excel's .xlsx bytes) — sniffing the data URL's own mime type here,
      // rather than trusting the config flag alone, keeps an <img> from
      // trying (and visibly failing) to render a spreadsheet as a picture.
      if (config.output_is_data_url && /^data:image\//.test(outputText)) {
        els.imagePreview.src = outputText;
        els.imagePreview.classList.remove('hidden');
      } else {
        els.imagePreview.classList.add('hidden');
        els.imagePreview.removeAttribute('src');
      }
    }

    var inputBytes = new Blob([inputText]).size;
    var outputBytes = new Blob([outputText]).size;
    els.resultInfo.textContent =
      formatBytes(inputBytes) + ' in → ' + formatBytes(outputBytes) + ' out';

    window._convertedText = outputText;
    window._convertedFilename = output.filename;

    setState('complete');

    trackEvent('conversion_completed', {
      tool_id: config.id,
      duration_ms: durationMs,
      file_size_bytes: inputBytes,
      output_size_bytes: outputBytes
    });
    postConversion(
      {
        tool_id: config.id,
        input_format: config.input_format,
        output_format: config.output_format,
        file_size_kb: FC.sizeKb(inputBytes),
        duration_ms: durationMs,
        status: 'success'
      },
      true
    );
  }

  // Converters may return a structured `table` alongside the plain `text`
  // (currently hash-generator.js, number-base-converter.js) — same
  // optional-extra-field contract shared-diff.js's renderDiffReport() uses
  // for json-diff.js's `diffs`: an extra field rides the worker's
  // postMessage structured-clone for free, so this only fires when a
  // converter opts in. Two shapes share the field: a flat array of
  // {label, value} (Hash Generator's fixed MD5/SHA-256 rows) or a grouped
  // array of {input, fields: [{label, value}, ...]} (Number Base
  // Converter's one row-group per input number) — distinguished by whether
  // the first entry carries `fields`.
  //
  // MAX_TABLE_ENTRIES guards against building the table at all for a
  // pathological input: unlike the plain-text textarea it replaces (one
  // cheap .value assignment regardless of size), building a DOM subtree
  // scales with entry count and runs synchronously on the main thread in
  // showResult() (only the conversion itself is off-thread, in the
  // Worker). Number Base Converter's one-group-per-line output means a
  // max-size (5MB) paste of short lines could ask for over a million
  // groups — falling back to the textarea above this is a display choice,
  // not a data loss: Copy/Download still read the full window._convertedText
  // regardless of which view is showing, and a table that long stops being
  // "scannable" (the entire reason for building one) well before it stops
  // being buildable.
  var MAX_TABLE_ENTRIES = 500;

  function renderOutputTable(output) {
    var hasTable =
      Array.isArray(output.table) &&
      output.table.length > 0 &&
      output.table.length <= MAX_TABLE_ENTRIES;
    if (!els.outputTable || !els.outputEditor) return;

    els.outputTable.classList.toggle('hidden', !hasTable);
    els.outputEditor.classList.toggle('hidden', hasTable);
    els.outputTable.innerHTML = '';
    if (!hasTable) return;

    var isGrouped = Array.isArray(output.table[0].fields);
    els.outputTable.appendChild(
      isGrouped ? buildGroupedOutputTable(output.table) : buildFlatOutputTable(output.table)
    );
  }

  // "Algorithm"/"Hash" are hardcoded, not derived from `rows` — fine while
  // Hash Generator is the only flat-table producer, but a second converter
  // reusing this {label, value} shape would silently get the wrong headers.
  // Not worth a `headers` field for one consumer; revisit if a second one
  // shows up.
  // The per-row copy icon's one and only rest state — used both to create
  // it and (in wireRowCopy's flash()) to reset it, so the two can never
  // drift out of sync with each other.
  var COPY_ICON_REST = '⧉';

  function buildFlatOutputTable(rows) {
    var table = document.createElement('table');
    table.className = 'out-table';
    table.innerHTML =
      '<colgroup><col style="width:22%"><col style="width:68%"><col style="width:10%"></colgroup>' +
      '<thead><tr><th>Algorithm</th><th>Hash</th><th></th></tr></thead>';

    var tbody = document.createElement('tbody');
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var tdLabel = document.createElement('td');
      tdLabel.textContent = row.label;
      var tdValue = document.createElement('td');
      tdValue.textContent = row.value;
      var tdCopy = document.createElement('td');
      tdCopy.className = 'copy';
      var copyIcon = document.createElement('span');
      copyIcon.className = 'copy-icon';
      copyIcon.textContent = COPY_ICON_REST;
      copyIcon.title = 'Copy';
      copyIcon.setAttribute('role', 'button');
      copyIcon.setAttribute('tabindex', '0');
      copyIcon.setAttribute('aria-label', 'Copy ' + row.label + ' value');
      wireRowCopy(copyIcon, row.value);
      tdCopy.appendChild(copyIcon);
      tr.appendChild(tdLabel);
      tr.appendChild(tdValue);
      tr.appendChild(tdCopy);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  // Per-row copy icon in the flat output table (hash-generator.js's
  // Algorithm/Hash rows) — separate from copyOutput()/els.copyBtn below,
  // which always copies the *whole* result, since a row only wants its own
  // value. Same synchronous-throw guard: accessing navigator.clipboard on
  // an unsupported/non-HTTPS context throws before any promise exists.
  function wireRowCopy(icon, value) {
    // Resets to the fixed rest glyph, not whatever icon.textContent happens
    // to be at call time — a second click inside the previous flash's
    // 1200ms window used to capture '✓' itself as "original", so the first
    // timeout's correct reset was immediately clobbered by the second
    // timeout resetting back to '✓', permanently. The rest state never
    // varies per icon, so there's nothing to capture.
    function flash(text) {
      icon.textContent = text;
      icon.classList.add('copy-icon--done');
      setTimeout(function () {
        icon.textContent = COPY_ICON_REST;
        icon.classList.remove('copy-icon--done');
      }, 1200);
    }
    function doCopy() {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        flash('!');
        return;
      }
      navigator.clipboard
        .writeText(value)
        .then(function () {
          flash('✓');
        })
        .catch(function () {
          flash('!');
        });
    }
    icon.addEventListener('click', doCopy);
    icon.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        doCopy();
      }
    });
  }

  function buildGroupedOutputTable(groups) {
    var table = document.createElement('table');
    table.className = 'kv-table';
    table.innerHTML = '<colgroup><col style="width:92px"><col></colgroup>';

    groups.forEach(function (group) {
      var tbody = document.createElement('tbody');
      tbody.className = 'group';

      var titleRow = document.createElement('tr');
      titleRow.className = 'group-title';
      var th = document.createElement('th');
      th.colSpan = 2;
      var eyebrow = document.createElement('span');
      eyebrow.className = 'eyebrow';
      eyebrow.textContent = 'Input';
      th.appendChild(eyebrow);
      th.appendChild(document.createTextNode(group.input));
      titleRow.appendChild(th);
      tbody.appendChild(titleRow);

      group.fields.forEach(function (field) {
        var tr = document.createElement('tr');
        var tdLabel = document.createElement('td');
        tdLabel.className = 'label';
        tdLabel.textContent = field.label;
        var tdValue = document.createElement('td');
        tdValue.className = 'value';
        tdValue.textContent = field.value;
        tr.appendChild(tdLabel);
        tr.appendChild(tdValue);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
    });
    return table;
  }

  // A bare .catch() isn't enough on its own: if navigator.clipboard doesn't
  // exist at all (old browser, non-HTTPS context), .writeText throws a
  // SYNCHRONOUS TypeError on property access, before any promise exists to
  // catch. Both paths need to land the user on the same visible fallback,
  // since a silent failure here looks identical to a silent success.
  function showCopyFallback(message) {
    var btn = els.copyBtn;
    var original = btn.textContent;
    btn.textContent = message;
    setTimeout(function () {
      btn.textContent = original;
    }, 2000);
  }

  function copyOutput() {
    if (!window._convertedText) return;
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showCopyFallback('Clipboard not available — select manually.');
      return;
    }
    navigator.clipboard
      .writeText(window._convertedText)
      .then(function () {
        var btn = els.copyBtn;
        var original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(function () {
          btn.textContent = original;
        }, 1500);
      })
      .catch(function () {
        showCopyFallback("Couldn't copy — select manually.");
      });
  }

  // A data: URL means the "text" output is really binary content encoded as
  // base64 (e.g. Base64 to Image) — downloading it as text/plain would save
  // the literal "data:image/png;base64,..." string as a broken image file.
  // Decode it back to real bytes with the right MIME type instead.
  function dataUrlToBlob(dataUrl) {
    var match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
    if (!match || !match[2]) return null;
    var mime = match[1] || 'application/octet-stream';
    var binary = atob(match[3]);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function downloadOutput() {
    if (!window._convertedText) return;
    // Gated on the tool's own config, not by sniffing whether the text
    // happens to start with "data:" — a tool that isn't output_is_data_url
    // (e.g. Base64 Encode/Decode) can legitimately produce output text that
    // starts with that literal string, and content-sniffing would silently
    // download the wrong bytes for it. See showResult()'s image-preview gate
    // above, which already keys off config.output_is_data_url the same way.
    var blob =
      (window.TOOL_CONFIG.output_is_data_url && dataUrlToBlob(window._convertedText)) ||
      new Blob([window._convertedText], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = window._convertedFilename || 'output.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    trackEvent('file_downloaded', {
      tool_id: window.TOOL_CONFIG.id,
      output_size_bytes: new Blob([window._convertedText]).size
    });
  }

  function resetUI() {
    els.inputArea.value = '';
    els.outputArea.value = '';
    if (els.imagePreview) {
      els.imagePreview.classList.add('hidden');
      els.imagePreview.removeAttribute('src');
    }
    refreshLineNumbers(els.inputArea);
    refreshLineNumbers(els.outputArea);
    window._convertedText = null;
    window._convertedFilename = null;
    els.progressFill.style.width = '0%';
    els.progress.classList.remove('progress--indeterminate');
    updateMeta();
    setState('empty');

    trackEvent('convert_another', { tool_id: window.TOOL_CONFIG.id });
  }

  function formatXml(xml) {
    var formatted = '';
    var indent = 0;
    xml = xml.replace(/(>)\s*(<)/g, '$1\n$2');
    var lines = xml.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.match(/^<\?/) || line.match(/^<!/)) {
        formatted += pad(indent) + line + '\n';
        continue;
      }
      var isClose = line.match(/^<\//);
      var isSelfClose = line.match(/\/>$/);
      var isOpenAndClose = line.match(/^<\w/) && line.match(/<\/[^>]+>$/);
      if (isClose) indent = Math.max(0, indent - 1);
      formatted += pad(indent) + line + '\n';
      if (!isClose && !isSelfClose && !isOpenAndClose && line.match(/^<\w/)) indent++;
    }
    return formatted.trim();
  }

  function pad(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '  ';
    return s;
  }

  function init() {
    var config = window.TOOL_CONFIG;
    if (!config || config.ui_type !== 'text-input') return;

    els.inputArea = document.getElementById('text-input');
    els.charCount = document.getElementById('char-count');
    els.byteCount = document.getElementById('byte-count');
    els.convertBtn = document.getElementById('convert-btn');
    els.progress = document.getElementById('progress');
    els.progressFill = document.getElementById('progress-fill');
    els.textResult = document.getElementById('text-result');
    els.outputArea = document.getElementById('text-output');
    els.outputEditor = document.getElementById('text-output-editor');
    els.outputTable = document.getElementById('text-output-table');
    els.imagePreview = document.getElementById('text-image-preview');
    els.resultInfo = document.getElementById('result-info');
    els.copyBtn = document.getElementById('copy-btn');
    els.downloadBtn = document.getElementById('download-btn');
    els.resetBtn = document.getElementById('reset-btn');
    els.errorMsg = document.getElementById('error-msg');
    els.formatBtn = document.getElementById('format-btn');
    els.status = document.getElementById('a11y-status');

    // Disabled by default, same as every existing tool's empty textarea —
    // except a tool that pre-fills the textarea via input_default (e.g. UUID
    // Generator's count field), which should be ready to run immediately
    // rather than waiting for an edit event that may never come.
    els.convertBtn.disabled = !els.inputArea.value.trim();

    var formattableFormats = ['json', 'xml', 'html'];
    function isFormattable() {
      return formattableFormats.indexOf(config.input_format.toLowerCase()) !== -1;
    }

    if (els.formatBtn) {
      if (isFormattable()) els.formatBtn.classList.remove('hidden');
      els.formatBtn.addEventListener('click', function () {
        var text = els.inputArea.value.trim();
        if (!text) return;
        var fmt = config.input_format.toLowerCase();
        if (fmt === 'xml' || fmt === 'html') {
          try {
            els.inputArea.value = formatXml(text);
            updateMeta();
            refreshLineNumbers(els.inputArea);
          } catch (e) {
            /* ignore */
          }
        } else if (fmt === 'json') {
          try {
            els.inputArea.value = JSON.stringify(JSON.parse(text), null, 2);
            updateMeta();
            refreshLineNumbers(els.inputArea);
          } catch (e) {
            /* ignore */
          }
        }
      });
    }

    els.inputArea.addEventListener('input', function () {
      updateMeta();
      els.errorMsg.classList.add('hidden');
      els.convertBtn.disabled = !els.inputArea.value.trim();
    });

    // Quick-pick counts (a number-kind input's optional input_presets in
    // tools/*.yaml, e.g. UUID Generator's 1/5/10/25/50/100) — the container
    // only exists in the DOM when a tool declares presets, so this is a
    // no-op for every other text-input tool.
    var presetWrap = document.getElementById('number-presets');
    if (presetWrap) {
      var presetChips = presetWrap.querySelectorAll('.chip');
      var syncActiveChip = function () {
        for (var i = 0; i < presetChips.length; i++) {
          var isActive = presetChips[i].dataset.value === els.inputArea.value;
          presetChips[i].classList.toggle('chip--active', isActive);
          presetChips[i].setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }
      };
      for (var p = 0; p < presetChips.length; p++) {
        presetChips[p].addEventListener('click', function () {
          els.inputArea.value = this.dataset.value;
          els.inputArea.dispatchEvent(new Event('input'));
          syncActiveChip();
        });
      }
      els.inputArea.addEventListener('input', syncActiveChip);
    }

    els.convertBtn.addEventListener('click', startConversion);
    els.copyBtn.addEventListener('click', copyOutput);
    els.downloadBtn.addEventListener('click', downloadOutput);
    els.resetBtn.addEventListener('click', resetUI);

    updateMeta();

    trackEvent('tool_view', {
      tool_id: config.id,
      tool_category: config.category || '',
      tool_type: config.type
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
