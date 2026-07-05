(function () {
'use strict';

var NL = String.fromCharCode(10);

window.convertText = function(text) {
  var parser = new DOMParser();
  var doc = parser.parseFromString(text, 'text/html');
  var md = convertNode(doc.body, 0);
  md = md.replace(/\n{3,}/g, NL + NL).trim();
  return { text: md, filename: 'document.md' };
};

function convertNode(node, listDepth) {
  var out = '';
  for (var i = 0; i < node.childNodes.length; i++) {
    out += processChild(node.childNodes[i], listDepth);
  }
  return out;
}

function processChild(node, listDepth) {
  if (node.nodeType === 3) {
    if (!node.textContent.trim()) return '';
    return node.textContent.replace(/\s+/g, ' ');
  }
  if (node.nodeType !== 1) return '';

  var tag = node.tagName.toLowerCase();
  var inner = convertNode(node, listDepth);

  switch (tag) {
    case 'h1': return '# ' + inner.trim() + NL + NL;
    case 'h2': return '## ' + inner.trim() + NL + NL;
    case 'h3': return '### ' + inner.trim() + NL + NL;
    case 'h4': return '#### ' + inner.trim() + NL + NL;
    case 'h5': return '##### ' + inner.trim() + NL + NL;
    case 'h6': return '###### ' + inner.trim() + NL + NL;
    case 'p': return inner.trim() + NL + NL;
    case 'br': return NL;
    case 'hr': return NL + '---' + NL + NL;
    case 'strong':
    case 'b': return '**' + inner.trim() + '**';
    case 'em':
    case 'i': return '*' + inner.trim() + '*';
    case 'del':
    case 's': return '~~' + inner.trim() + '~~';
    case 'code':
      if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') return inner;
      return '`' + node.textContent + '`';
    case 'pre':
      var codeEl = node.querySelector('code');
      var lang = '';
      if (codeEl) {
        var cls = codeEl.className || '';
        var langMatch = cls.match(/language-(\S+)/);
        if (langMatch) lang = langMatch[1];
        return NL + '```' + lang + NL + codeEl.textContent + NL + '```' + NL + NL;
      }
      return NL + '```' + NL + node.textContent + NL + '```' + NL + NL;
    case 'a':
      var href = node.getAttribute('href') || '';
      return '[' + inner.trim() + '](' + href + ')';
    case 'img':
      var src = node.getAttribute('src') || '';
      var alt = node.getAttribute('alt') || '';
      return '![' + alt + '](' + src + ')';
    case 'blockquote':
      var lines = inner.trim().split(NL);
      return NL + lines.map(function(l) { return '> ' + l; }).join(NL) + NL + NL;
    case 'ul':
      return NL + convertList(node, false, listDepth) + NL;
    case 'ol':
      return NL + convertList(node, true, listDepth) + NL;
    case 'li':
      return inner.trim();
    case 'table':
      return NL + convertTable(node) + NL;
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'span':
      return inner;
    default:
      return inner;
  }
}

function convertList(node, ordered, depth) {
  var out = '';
  var indent = rpt('  ', depth);
  var idx = 1;
  for (var i = 0; i < node.children.length; i++) {
    var child = node.children[i];
    if (child.tagName.toLowerCase() !== 'li') continue;

    var prefix = ordered ? (idx + '. ') : '- ';
    var content = '';
    for (var j = 0; j < child.childNodes.length; j++) {
      var cn = child.childNodes[j];
      var cnTag = cn.tagName ? cn.tagName.toLowerCase() : '';
      if (cnTag === 'ul' || cnTag === 'ol') {
        content += NL + convertList(cn, cnTag === 'ol', depth + 1);
      } else {
        content += processChild(cn, depth);
      }
    }
    out += indent + prefix + content.trim() + NL;
    idx++;
  }
  return out;
}

function convertTable(table) {
  var rows = [];
  var allRows = table.querySelectorAll('tr');
  for (var r = 0; r < allRows.length; r++) {
    var cells = [];
    var cellEls = allRows[r].querySelectorAll('th, td');
    for (var c = 0; c < cellEls.length; c++) {
      cells.push(cellEls[c].textContent.trim().replace(/\|/g, '\\|'));
    }
    rows.push(cells);
  }
  if (rows.length === 0) return '';

  var out = '| ' + rows[0].join(' | ') + ' |' + NL;
  out += '|' + rows[0].map(function() { return '---|'; }).join('') + NL;
  for (var i = 1; i < rows.length; i++) {
    out += '| ' + rows[i].join(' | ') + ' |' + NL;
  }
  return out;
}

function rpt(str, n) {
  var out = '';
  for (var i = 0; i < n; i++) out += str;
  return out;
}

})();
