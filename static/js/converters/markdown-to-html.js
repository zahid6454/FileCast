(function () {
  'use strict';

  window.convertText = function (text) {
    var html = markdownToHtml(text);
    return { text: html, filename: 'document.html' };
  };

  function markdownToHtml(md) {
    var lines = md.split(String.fromCharCode(10));
    var html = '';
    var inCodeBlock = false;
    var codeLang = '';
    var codeLines = [];
    var inList = false;
    var listType = '';
    var inBlockquote = false;
    var blockquoteLines = [];
    var NL = String.fromCharCode(10);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (inCodeBlock) {
        if (line.trim() === '```') {
          html +=
            '<pre><code' +
            (codeLang ? ' class="language-' + codeLang + '"' : '') +
            '>' +
            escapeHtml(codeLines.join(NL)) +
            '</code></pre>' +
            NL;
          inCodeBlock = false;
          codeLines = [];
          codeLang = '';
        } else {
          codeLines.push(line);
        }
        continue;
      }

      if (line.trim().indexOf('```') === 0) {
        if (inList) {
          html += '</' + listType + '>' + NL;
          inList = false;
        }
        if (inBlockquote) {
          html += processBlockquote(blockquoteLines);
          inBlockquote = false;
          blockquoteLines = [];
        }
        inCodeBlock = true;
        codeLang = line.trim().substring(3).trim();
        continue;
      }

      if (line.trim().charAt(0) === '>') {
        if (inList) {
          html += '</' + listType + '>' + NL;
          inList = false;
        }
        inBlockquote = true;
        blockquoteLines.push(line.trim().substring(1).trim());
        continue;
      } else if (inBlockquote) {
        html += processBlockquote(blockquoteLines);
        inBlockquote = false;
        blockquoteLines = [];
      }

      if (line.trim() === '') {
        if (inList) {
          html += '</' + listType + '>' + NL;
          inList = false;
        }
        continue;
      }

      var headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        if (inList) {
          html += '</' + listType + '>' + NL;
          inList = false;
        }
        var level = headingMatch[1].length;
        html +=
          '<h' + level + '>' + processInline(headingMatch[2].trim()) + '</h' + level + '>' + NL;
        continue;
      }

      if (
        line.trim().match(/^---+$/) ||
        line.trim().match(/^\*\*\*+$/) ||
        line.trim().match(/^___+$/)
      ) {
        if (inList) {
          html += '</' + listType + '>' + NL;
          inList = false;
        }
        html += '<hr>' + NL;
        continue;
      }

      var ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) html += '</' + listType + '>' + NL;
          html += '<ul>' + NL;
          inList = true;
          listType = 'ul';
        }
        html += '<li>' + processInline(ulMatch[2]) + '</li>' + NL;
        continue;
      }

      var olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
      if (olMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) html += '</' + listType + '>' + NL;
          html += '<ol>' + NL;
          inList = true;
          listType = 'ol';
        }
        html += '<li>' + processInline(olMatch[2]) + '</li>' + NL;
        continue;
      }

      if (inList) {
        html += '</' + listType + '>' + NL;
        inList = false;
      }
      html += '<p>' + processInline(line) + '</p>' + NL;
    }

    if (inList) html += '</' + listType + '>' + NL;
    if (inBlockquote) html += processBlockquote(blockquoteLines);
    if (inCodeBlock) {
      html += '<pre><code>' + escapeHtml(codeLines.join(NL)) + '</code></pre>' + NL;
    }

    return html.trim();
  }

  function processBlockquote(lines) {
    var NL = String.fromCharCode(10);
    return (
      '<blockquote>' +
      NL +
      '<p>' +
      lines.map(processInline).join('<br>') +
      '</p>' +
      NL +
      '</blockquote>' +
      NL
    );
  }

  function processInline(text) {
    text = escapeHtml(text);
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return text;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
