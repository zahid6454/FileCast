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

  function setState(newState) {
    state = newState;
    els.convertBtn.disabled = newState === 'converting';
    els.progress.classList.toggle('hidden', newState !== 'converting');
    els.errorMsg.classList.add('hidden');
    if (newState === 'complete') {
      els.textResult.classList.remove('hidden');
    } else if (newState === 'empty') {
      els.textResult.classList.add('hidden');
    }
  }

  function updateMeta() {
    var text = els.inputArea.value;
    var bytes = new Blob([text]).size;
    els.charCount.textContent = text.length.toLocaleString() + ' chars';
    els.byteCount.textContent = formatBytes(bytes);
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
    els.progress.classList.add('hidden');
    els.errorMsg.textContent = message;
    els.errorMsg.classList.remove('hidden');
    if (state === 'converting') setState('empty');
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

    if (typeof window.convertText !== 'function') {
      showError('Converter not loaded. Please refresh the page.');
      return;
    }

    setState('converting');
    var config = window.TOOL_CONFIG;
    var startTime = Date.now();

    trackEvent('conversion_started', {
      tool_id: config.id,
      input_format: config.input_format,
      output_format: config.output_format,
      file_size_bytes: new Blob([text]).size
    });

    els.progress.classList.remove('hidden');
    els.progress.classList.add('progress--indeterminate');
    els.progressFill.style.width = '';

    try {
      var output = window.convertText(text);
      var durationMs = Date.now() - startTime;
      showResult(text, output, durationMs);
    } catch (err) {
      showError(err.message || 'Conversion failed. Please check your input and try again.');
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
  }

  function showResult(inputText, output, durationMs) {
    var config = window.TOOL_CONFIG;
    var outputText = output.text;

    els.outputArea.value = outputText;
    els.textResult.classList.remove('hidden');

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
        file_size_kb: Math.round(inputBytes / 1024),
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
    els.inputArea.value = '';
    els.outputArea.value = '';
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
    els.resultInfo = document.getElementById('result-info');
    els.copyBtn = document.getElementById('copy-btn');
    els.downloadBtn = document.getElementById('download-btn');
    els.resetBtn = document.getElementById('reset-btn');
    els.errorMsg = document.getElementById('error-msg');
    els.formatBtn = document.getElementById('format-btn');

    els.convertBtn.disabled = true;

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
          } catch (e) {
            /* ignore */
          }
        } else if (fmt === 'json') {
          try {
            els.inputArea.value = JSON.stringify(JSON.parse(text), null, 2);
            updateMeta();
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
