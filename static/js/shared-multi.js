(function () {
  'use strict';

  var state = 'empty';
  var selectedFiles = [];
  var results = [];
  var els = {};

  // Shared helpers live in fc-util.js (loaded before this file). A batch is ONE
  // summary postConversion POST (never one per file); see fc-util.js/shared.js
  // for the fire-and-forget tracking contract.
  var FC = window.FC || {};
  var formatBytes = FC.formatBytes;
  var trackEvent = FC.trackEvent;
  var postConversion = FC.postConversion;
  var getExtension = FC.getExtension;
  var generateOutputFilename = FC.generateOutputFilename;

  function setState(newState) {
    state = newState;
    els.uploadZone.classList.toggle('hidden', newState !== 'empty' && newState !== 'selected');
    els.convertBtn.classList.toggle('hidden', newState === 'converting' || newState === 'complete');
    els.progress.classList.toggle('hidden', newState !== 'converting');
    els.multiResult.classList.toggle('hidden', newState !== 'complete');
    els.errorMsg.classList.add('hidden');

    if (newState === 'empty') {
      els.convertBtn.disabled = true;
      els.fileList.classList.add('hidden');
    } else if (newState === 'selected') {
      els.convertBtn.disabled = false;
    } else if (newState === 'converting') {
      els.convertBtn.disabled = true;
    }
  }

  function validateFile(file) {
    var config = window.TOOL_CONFIG;
    var ext = getExtension(file.name);
    if (!config.accept_extensions.includes(ext)) {
      return {
        valid: false,
        error: file.name + ': wrong format. Accepts ' + config.accept_extensions.join(', ') + '.',
        error_type: 'wrong_format'
      };
    }
    if (file.size > config.max_file_size_bytes) {
      return {
        valid: false,
        error: file.name + ': too large. Max: ' + config.max_file_size + '.',
        error_type: 'too_large'
      };
    }
    if (file.size === 0) {
      return { valid: false, error: file.name + ': file is empty.', error_type: 'empty_file' };
    }
    return { valid: true };
  }

  function addFiles(fileList) {
    var config = window.TOOL_CONFIG;
    var maxFiles = config.max_files || 10;

    for (var i = 0; i < fileList.length; i++) {
      if (selectedFiles.length >= maxFiles) {
        showError('Maximum ' + maxFiles + ' files allowed.');
        break;
      }
      var file = fileList[i];
      var result = validateFile(file);
      if (!result.valid) {
        showError(result.error);
        trackEvent('conversion_failed', { tool_id: config.id, error_type: result.error_type });
        continue;
      }
      selectedFiles.push(file);
    }

    renderFileList();
    if (selectedFiles.length > 0) {
      setState('selected');
    }
  }

  function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
    if (selectedFiles.length === 0) {
      setState('empty');
    }
  }

  function renderFileList() {
    els.fileList.innerHTML = '';
    for (var i = 0; i < selectedFiles.length; i++) {
      var file = selectedFiles[i];
      var item = document.createElement('div');
      item.className = 'file-list__item';
      item.setAttribute('data-index', i);

      var name = document.createElement('span');
      name.className = 'file-list__name';
      name.textContent = file.name;

      var size = document.createElement('span');
      size.className = 'file-list__size';
      size.textContent = formatBytes(file.size);

      var remove = document.createElement('button');
      remove.className = 'file-list__remove';
      remove.textContent = '×';
      remove.setAttribute('data-index', i);
      remove.addEventListener('click', function () {
        removeFile(parseInt(this.getAttribute('data-index'), 10));
      });

      item.appendChild(name);
      item.appendChild(size);
      item.appendChild(remove);
      els.fileList.appendChild(item);
    }

    els.fileListCount.textContent =
      selectedFiles.length + ' file' + (selectedFiles.length === 1 ? '' : 's') + ' selected';
    els.fileList.classList.remove('hidden');
    els.fileListCount.classList.remove('hidden');
  }

  function showError(message) {
    els.progress.classList.add('hidden');
    els.errorMsg.textContent = message;
    els.errorMsg.classList.remove('hidden');
  }

  function updateFileItem(index, statusClass, statusText) {
    var items = els.fileList.querySelectorAll('.file-list__item');
    if (items[index]) {
      var item = items[index];
      item.className = 'file-list__item ' + (statusClass || '');
      var existing = item.querySelector('.file-list__status');
      if (existing) existing.remove();
      var removeBtn = item.querySelector('.file-list__remove');
      if (removeBtn) removeBtn.remove();

      var status = document.createElement('span');
      status.className =
        'file-list__status ' +
        (statusClass === 'file-list__item--done'
          ? 'file-list__status--done'
          : 'file-list__status--error');
      status.textContent = statusText;
      item.appendChild(status);
    }
  }

  function startConversion() {
    if (state !== 'selected' || selectedFiles.length === 0) return;

    var hasBatch = typeof window.convertFiles === 'function';
    var hasSingle = typeof window.convertFile === 'function';
    if (!hasBatch && !hasSingle) {
      showError('Converter not loaded. Please refresh the page.');
      return;
    }

    setState('converting');
    results = [];
    var config = window.TOOL_CONFIG;
    var startTime = Date.now();

    trackEvent('conversion_started', {
      tool_id: config.id,
      input_format: config.input_format,
      output_format: config.output_format,
      file_count: selectedFiles.length
    });

    els.progress.classList.remove('hidden');

    if (hasBatch) {
      els.progress.classList.add('progress--indeterminate');
      els.progressFill.style.width = '';

      Promise.resolve()
        .then(function () {
          return window.convertFiles(selectedFiles.slice());
        })
        .then(function (batchResult) {
          var durationMs = Date.now() - startTime;
          var totalIn = 0;
          selectedFiles.forEach(function (f) {
            totalIn += f.size;
          });
          results.push({
            success: true,
            blob: batchResult.blob,
            filename: batchResult.filename,
            originalSize: totalIn,
            outputSize: batchResult.blob.size
          });
          selectedFiles.forEach(function (_, idx) {
            updateFileItem(idx, 'file-list__item--done', 'Done');
          });
          showResults(durationMs);
        })
        .catch(function (err) {
          showError(err.message || 'Processing failed. One or more files may be corrupted.');
          setState('selected');
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
        });
      return;
    }

    els.progress.classList.remove('progress--indeterminate');
    var current = 0;
    function processNext() {
      if (current >= selectedFiles.length) {
        var durationMs = Date.now() - startTime;
        showResults(durationMs);
        return;
      }

      var pct = Math.round((current / selectedFiles.length) * 100);
      els.progressFill.style.width = pct + '%';

      var file = selectedFiles[current];
      var idx = current;

      Promise.resolve()
        .then(function () {
          return window.convertFile(file);
        })
        .then(function (blob) {
          var outExt = config.output_extension;
          if (config.input_format === config.output_format) {
            outExt = getExtension(file.name) || outExt;
          }
          var filename = generateOutputFilename(file.name, outExt);
          results.push({
            success: true,
            blob: blob,
            filename: filename,
            originalSize: file.size,
            outputSize: blob.size
          });
          updateFileItem(idx, 'file-list__item--done', 'Done');
          current++;
          processNext();
        })
        .catch(function (err) {
          results.push({ success: false, error: err.message || 'Failed', originalName: file.name });
          updateFileItem(idx, 'file-list__item--error', 'Failed');
          current++;
          processNext();
        });
    }

    processNext();
  }

  function showResults(durationMs) {
    els.progressFill.style.width = '100%';

    var successes = results.filter(function (r) {
      return r.success;
    });
    var failures = results.filter(function (r) {
      return !r.success;
    });

    var totalIn = 0,
      totalOut = 0;
    successes.forEach(function (r) {
      totalIn += r.originalSize;
      totalOut += r.outputSize;
    });

    var summary = successes.length + ' of ' + results.length + ' files converted';
    if (successes.length > 0) {
      summary += ' (' + formatBytes(totalIn) + ' → ' + formatBytes(totalOut) + ')';
    }
    if (failures.length > 0) {
      summary += '. ' + failures.length + ' failed.';
    }

    els.resultSummary.textContent = summary;

    els.resultActions.innerHTML = '';
    successes.forEach(function (r, i) {
      var btn = document.createElement('button');
      btn.className = 'btn btn--success';
      btn.textContent = 'Download ' + r.filename;
      btn.addEventListener('click', function () {
        downloadBlob(r.blob, r.filename);
      });
      els.resultActions.appendChild(btn);
    });

    var resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn--primary';
    resetBtn.textContent = 'Start Over';
    resetBtn.addEventListener('click', resetUI);
    els.resultActions.appendChild(resetBtn);

    setState('complete');

    trackEvent('conversion_completed', {
      tool_id: window.TOOL_CONFIG.id,
      duration_ms: durationMs,
      file_count: results.length,
      success_count: successes.length
    });
    var cfg = window.TOOL_CONFIG;
    postConversion(
      {
        tool_id: cfg.id,
        input_format: cfg.input_format,
        output_format: cfg.output_format,
        file_count: results.length,
        success_count: successes.length,
        duration_ms: durationMs,
        status: 'success'
      },
      true
    );
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    trackEvent('file_downloaded', {
      tool_id: window.TOOL_CONFIG.id,
      output_size_bytes: blob.size
    });
  }

  function resetUI() {
    selectedFiles = [];
    results = [];
    els.fileList.innerHTML = '';
    els.fileList.classList.add('hidden');
    els.fileListCount.classList.add('hidden');
    els.resultActions.innerHTML = '';
    els.progressFill.style.width = '0%';
    els.progress.classList.remove('progress--indeterminate');
    els.fileInput.value = '';
    setState('empty');

    trackEvent('convert_another', { tool_id: window.TOOL_CONFIG.id });
  }

  function initUploadZone() {
    var zone = els.uploadZone;
    var input = els.fileInput;

    zone.addEventListener('click', function () {
      input.click();
    });

    input.addEventListener('change', function () {
      if (input.files && input.files.length > 0) {
        addFiles(input.files);
        input.value = '';
      }
    });

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
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    });
  }

  function init() {
    var config = window.TOOL_CONFIG;
    if (!config || config.ui_type !== 'multi-file') return;

    els.uploadZone = document.getElementById('upload-zone');
    els.fileInput = document.getElementById('file-input');
    els.fileList = document.getElementById('file-list');
    els.fileListCount = document.getElementById('file-list-count');
    els.convertBtn = document.getElementById('convert-btn');
    els.progress = document.getElementById('progress');
    els.progressFill = document.getElementById('progress-fill');
    els.multiResult = document.getElementById('multi-result');
    els.resultSummary = document.getElementById('result-summary');
    els.resultActions = document.getElementById('result-actions');
    els.errorMsg = document.getElementById('error-msg');

    initUploadZone();
    els.convertBtn.addEventListener('click', startConversion);

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
