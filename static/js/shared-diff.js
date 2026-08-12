(function () {
  'use strict';

  // Controller for the two-input "diff" tool family (tool-diff.html) —
  // mirrors shared-text.js's state machine and off-main-thread pattern (P4
  // §36 / O4 #19) but drives two textareas instead of one, and posts to the
  // dedicated text-diff-worker.js rather than the generic single-input
  // text-converter-worker.js.

  var state = 'empty';
  var els = {};

  var FC = window.FC || {};
  var formatBytes = FC.formatBytes;
  var trackEvent = FC.trackEvent;
  var postConversion = FC.postConversion;

  function announceState(newState) {
    if (!els.status) return;
    if (newState === 'converting') {
      els.status.textContent = 'Comparing…';
    } else if (newState === 'complete') {
      els.status.textContent = 'Comparison complete. Result ready.';
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

  function updateMeta(area, charCountEl, byteCountEl) {
    var text = area.value;
    var bytes = new Blob([text]).size;
    charCountEl.textContent = text.length.toLocaleString() + ' chars';
    byteCountEl.textContent = formatBytes(bytes);
  }

  function validate(textA, textB) {
    var config = window.TOOL_CONFIG;
    if (!textA.trim() || !textB.trim()) {
      return {
        valid: false,
        error: 'Please paste content into both text areas before comparing.',
        error_type: 'empty_input'
      };
    }
    var bytes = new Blob([textA]).size + new Blob([textB]).size;
    if (bytes > config.max_file_size_bytes) {
      return {
        valid: false,
        error: 'Input is too large. Maximum size: ' + config.max_file_size + ' combined.',
        error_type: 'too_large'
      };
    }
    return { valid: true };
  }

  function showError(message) {
    // setState() unconditionally re-hides #error-msg — it must run before
    // we reveal the error, not after, or the message gets hidden again
    // immediately (see shared-text.js's showError() for the same fix).
    if (state === 'converting') setState('empty');
    els.progress.classList.add('hidden');
    els.errorMsg.textContent = message;
    els.errorMsg.classList.remove('hidden');
    if (els.status) els.status.textContent = message;
  }

  function startConversion() {
    var textA = els.inputAreaA.value;
    var textB = els.inputAreaB.value;
    var result = validate(textA, textB);
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
      showError('Comparison is unavailable right now. Please refresh the page.');
      return;
    }

    setState('converting');
    var startTime = Date.now();
    var totalBytes = new Blob([textA]).size + new Blob([textB]).size;

    trackEvent('conversion_started', {
      tool_id: config.id,
      input_format: config.input_format,
      output_format: config.output_format,
      file_size_bytes: totalBytes
    });
    FC.setSentryContext({
      tool_id: config.id,
      input_format: config.input_format,
      output_format: config.output_format,
      file_size_bytes: totalBytes,
      mode: config.type === 'server-side' ? 'Cloud' : 'Local'
    });

    els.progress.classList.remove('hidden');
    els.progress.classList.add('progress--indeterminate');
    els.progressFill.style.width = '';

    function onFailure(message) {
      showError(message || 'Comparison failed. Please check your input and try again.');
      trackEvent('conversion_failed', { tool_id: config.id, error_type: 'conversion_error' });
      postConversion(
        {
          tool_id: config.id,
          input_format: config.input_format,
          output_format: config.output_format,
          status: 'failed'
        },
        false
      );
    }

    var worker = new Worker(
      config.text_converter_worker_src +
        '?converter=' +
        encodeURIComponent(config.text_converter_src)
    );
    worker.onmessage = function (e) {
      worker.terminate();
      var data = e.data || {};
      if (!data.ok) {
        onFailure(data.error);
        return;
      }
      var durationMs = Date.now() - startTime;
      showResult(totalBytes, data.result, durationMs);
    };
    worker.onerror = function (err) {
      worker.terminate();
      onFailure(err && err.message);
    };
    worker.postMessage({ textA: textA, textB: textB });
  }

  function showResult(inputBytes, output, durationMs) {
    var config = window.TOOL_CONFIG;
    var outputText = output.text;

    els.outputArea.value = outputText;
    els.textResult.classList.remove('hidden');

    var outputBytes = new Blob([outputText]).size;
    els.resultInfo.textContent =
      formatBytes(inputBytes) + ' compared → ' + formatBytes(outputBytes) + ' report';

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

  function copyOutput() {
    if (!window._convertedText) return;
    navigator.clipboard.writeText(window._convertedText).then(function () {
      var btn = els.copyBtn;
      var original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function () {
        btn.textContent = original;
      }, 1500);
    });
  }

  function downloadOutput() {
    if (!window._convertedText) return;
    var blob = new Blob([window._convertedText], { type: 'text/plain;charset=utf-8' });
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
    els.inputAreaA.value = '';
    els.inputAreaB.value = '';
    window._convertedText = null;
    window._convertedFilename = null;
    els.progressFill.style.width = '0%';
    els.progress.classList.remove('progress--indeterminate');
    updateMeta(els.inputAreaA, els.charCountA, els.byteCountA);
    updateMeta(els.inputAreaB, els.charCountB, els.byteCountB);
    setState('empty');

    trackEvent('convert_another', { tool_id: window.TOOL_CONFIG.id });
  }

  function updateConvertEnabled() {
    els.convertBtn.disabled = !els.inputAreaA.value.trim() || !els.inputAreaB.value.trim();
  }

  function init() {
    var config = window.TOOL_CONFIG;
    if (!config || config.ui_type !== 'text-diff') return;

    els.inputAreaA = document.getElementById('text-input-a');
    els.inputAreaB = document.getElementById('text-input-b');
    els.charCountA = document.getElementById('char-count-a');
    els.byteCountA = document.getElementById('byte-count-a');
    els.charCountB = document.getElementById('char-count-b');
    els.byteCountB = document.getElementById('byte-count-b');
    els.convertBtn = document.getElementById('convert-btn');
    els.progress = document.getElementById('progress');
    els.progressFill = document.getElementById('progress-fill');
    els.textResult = document.getElementById('text-result');
    els.outputArea = document.getElementById('text-output');
    els.resultInfo = document.getElementById('result-info');
    els.copyBtn = document.getElementById('copy-btn');
    els.downloadBtn = document.getElementById('download-btn');
    els.resetBtn = document.getElementById('reset-btn');
    els.errorMsg = document.getElementById('error-msg');
    els.status = document.getElementById('a11y-status');

    els.convertBtn.disabled = true;

    els.inputAreaA.addEventListener('input', function () {
      updateMeta(els.inputAreaA, els.charCountA, els.byteCountA);
      els.errorMsg.classList.add('hidden');
      updateConvertEnabled();
    });
    els.inputAreaB.addEventListener('input', function () {
      updateMeta(els.inputAreaB, els.charCountB, els.byteCountB);
      els.errorMsg.classList.add('hidden');
      updateConvertEnabled();
    });

    els.convertBtn.addEventListener('click', startConversion);
    els.copyBtn.addEventListener('click', copyOutput);
    els.downloadBtn.addEventListener('click', downloadOutput);
    els.resetBtn.addEventListener('click', resetUI);

    updateMeta(els.inputAreaA, els.charCountA, els.byteCountA);
    updateMeta(els.inputAreaB, els.charCountB, els.byteCountB);

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
