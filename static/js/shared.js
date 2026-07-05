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
  // Utilities
  // ---------------------------------------------------------------------------
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    var k = 1024;
    var sizes = ['Bytes', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function trackEvent(name, params) {
    if (typeof gtag === 'function') {
      gtag('event', name, params);
    }
  }

  function getExtension(filename) {
    var parts = filename.split('.');
    return parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
  }

  function generateOutputFilename(originalName, outputExt) {
    var base = originalName.substring(0, originalName.lastIndexOf('.'));
    if (!base) base = originalName;
    return base + outputExt;
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  function validateFile(file) {
    var config = window.TOOL_CONFIG;
    if (!config) return { valid: false, error: 'Tool configuration not found.', error_type: 'missing_config' };

    var ext = getExtension(file.name);
    if (!config.accept_extensions.includes(ext)) {
      return {
        valid: false,
        error_type: 'wrong_format',
        error: 'This tool accepts ' + config.accept_extensions.join(', ') +
               ' files. You selected a ' + (ext || 'unknown') + ' file.'
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
  function setState(newState) {
    state = newState;

    var isToolPage = !!window.TOOL_CONFIG;
    if (!isToolPage) return;

    els.uploadZone.classList.toggle('hidden', newState !== 'empty');
    els.fileInfo.classList.toggle('hidden', newState === 'empty');
    els.convertBtn.classList.toggle('hidden', newState === 'converting' || newState === 'complete');
    els.progress.classList.toggle('hidden', newState !== 'converting');
    els.result.classList.toggle('hidden', newState !== 'complete');
    els.errorMsg.classList.add('hidden');

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
      preview.onload = function () { URL.revokeObjectURL(url); };
      preview.onerror = function () { URL.revokeObjectURL(url); preview.classList.add('hidden'); };
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

    var config = window.TOOL_CONFIG;
    var startTime = Date.now();

    trackEvent('conversion_started', {
      tool_id: config.id,
      input_format: config.input_format,
      output_format: config.output_format,
      file_size_bytes: currentFile.size
    });

    // Progress: if converter provides a progress callback, use real progress
    var hasProgress = typeof window.convertProgress === 'function';
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
      .then(function () { return window.convertFile(currentFile); })
      .then(function (blob) {
        var durationMs = Date.now() - startTime;
        var savingsPct = currentFile.size > 0
          ? Math.round((1 - blob.size / currentFile.size) * 100)
          : 0;
        showResult(currentFile, blob, durationMs);
        trackEvent('conversion_completed', {
          tool_id: config.id,
          input_format: config.input_format,
          output_format: config.output_format,
          duration_ms: durationMs,
          file_size_bytes: currentFile.size,
          output_size_bytes: blob.size,
          savings_percent: savingsPct
        });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : 'Conversion failed. Please try again.';
        showError(msg);
        trackEvent('conversion_failed', {
          tool_id: config.id,
          error_type: 'conversion_error'
        });
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
    var savings = originalSize > 0
      ? Math.round((1 - convertedSize / originalSize) * 100)
      : 0;

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

    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

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
  }

  // ---------------------------------------------------------------------------
  // Feedback widget
  // ---------------------------------------------------------------------------
  window.submitFeedback = function (response) {
    var config = window.TOOL_CONFIG;
    if (config) {
      trackEvent('feedback_submitted', {
        tool_id: config.id,
        response: response
      });
    }

    var el = document.getElementById('feedback');
    if (el) {
      el.innerHTML = '<span>Thanks for your feedback!</span>';
    }
  };

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
        cards.forEach(function (card) { card.classList.remove('hidden'); });
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

    // Related tool click tracking (runs on tool pages)
    initRelatedToolTracking();

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
    els.result = document.getElementById('result');
    els.resultInfo = document.getElementById('result-info');
    els.downloadBtn = document.getElementById('download-btn');
    els.resetBtn = document.getElementById('reset-btn');
    els.errorMsg = document.getElementById('error-msg');

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
