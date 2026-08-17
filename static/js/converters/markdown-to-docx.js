(function () {
  'use strict';

  window.convertFile = function (file) {
    // Assigned here, before the return below, not down where they're grouped
    // with their related helpers — a `var` initializer after a `return`
    // statement never runs (the function has already returned), unlike the
    // `function` declarations below it, which are hoisted with their full body
    // and stay callable regardless of source order.
    var HEADING_SIZES = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 11 };
    var LIST_QUOTE_INDENT = '<w:pPr><w:ind w:left="720"/></w:pPr>';
    // The URL inside a link/image's (...) is matched with one level of
    // balanced nesting allowed — `[^()]+` alone truncates at the first `)`,
    // which breaks on real-world URLs like Wikipedia's
    // https://en.wikipedia.org/wiki/Foo_(bar) that contain their own parens.
    var LINK_URL = '(?:[^()]|\\([^()]*\\))+';

    return file.text().then(function (text) {
      if (!text || !text.trim()) {
        throw new Error('This file has no content to convert.');
      }
      var blocks = parseMarkdownBlocks(text);
      var bodyXml = blocks.map(blockToParagraphXml).join('');
      var bytes = buildDocx(bodyXml);
      return new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
    });

    // --------------------------------------------------------------------- //
    // Markdown block/inline parsing — duplicated (not shared) from
    // static/js/workers/pdf-lib-worker.js's markdown-to-pdf support, matching
    // this codebase's existing convention of self-contained converter files.
    // Unlike a PDF, a .docx reader (Word/LibreOffice/Google Docs) reflows text
    // itself, so there's no word-wrap or pagination to do here — just emit one
    // paragraph per block and let the reader lay it out.
    // --------------------------------------------------------------------- //

    // Alternation order is load-bearing: `***bold italic***` must be tried
    // before `**bold**` before `*italic*`, or the longer marker never matches
    // (a shorter alternative earlier in the list would consume its two/one
    // leading asterisks first, at the same string position, since JS regex
    // alternation picks the first alternative that matches at the current
    // position, not the longest).
    function parseInlineRuns(str) {
      var runs = [];
      var pos = 0;
      var re = new RegExp(
        '(`[^`]+`)|(\\*\\*\\*[^*]+\\*\\*\\*)|(\\*\\*[^*]+\\*\\*)|(__[^_]+__)|(\\*[^*]+\\*)|(_[^_]+_)|(~~[^~]+~~)|' +
          '(!\\[[^\\]]*\\]\\(' +
          LINK_URL +
          '\\))|(\\[[^\\]]+\\]\\(' +
          LINK_URL +
          '\\))',
        'g'
      );
      var match;
      while ((match = re.exec(str)) !== null) {
        if (match.index > pos) {
          runs.push({ text: str.slice(pos, match.index), bold: false, italic: false, code: false });
        }
        var token = match[0];
        if (token.charAt(0) === '`') {
          runs.push({ text: token.slice(1, -1), bold: false, italic: false, code: true });
        } else if (token.indexOf('***') === 0) {
          runs.push({ text: token.slice(3, -3), bold: true, italic: true, code: false });
        } else if (token.indexOf('**') === 0) {
          runs.push({ text: token.slice(2, -2), bold: true, italic: false, code: false });
        } else if (token.indexOf('__') === 0) {
          runs.push({ text: token.slice(2, -2), bold: true, italic: false, code: false });
        } else if (token.indexOf('~~') === 0) {
          runs.push({ text: token.slice(2, -2), bold: false, italic: false, code: false });
        } else if (token.charAt(0) === '*') {
          runs.push({ text: token.slice(1, -1), bold: false, italic: true, code: false });
        } else if (token.charAt(0) === '_') {
          runs.push({ text: token.slice(1, -1), bold: false, italic: true, code: false });
        } else if (token.charAt(0) === '!') {
          var imgAlt = /!\[([^\]]*)\]/.exec(token);
          runs.push({
            text: '[Image: ' + (imgAlt ? imgAlt[1] : '') + ']',
            bold: false,
            italic: false,
            code: false
          });
        } else if (token.charAt(0) === '[') {
          var linkMatch = new RegExp('\\[([^\\]]+)\\]\\((' + LINK_URL + ')\\)').exec(token);
          runs.push({
            text: linkMatch[1] + ' (' + linkMatch[2] + ')',
            bold: false,
            italic: false,
            code: false
          });
        }
        pos = re.lastIndex;
      }
      if (pos < str.length) {
        runs.push({ text: str.slice(pos), bold: false, italic: false, code: false });
      }
      return runs;
    }

    function parseMarkdownBlocks(md) {
      var lines = md.replace(/\r\n/g, '\n').split('\n');
      var blocks = [];
      var i = 0;
      while (i < lines.length) {
        var line = lines[i];

        if (line.trim().indexOf('```') === 0) {
          var codeLines = [];
          i++;
          while (i < lines.length && lines[i].trim() !== '```') {
            codeLines.push(lines[i]);
            i++;
          }
          i++;
          blocks.push({ type: 'code', lines: codeLines });
          continue;
        }

        if (line.trim().charAt(0) === '>') {
          var quoteLines = [];
          while (i < lines.length && lines[i].trim().charAt(0) === '>') {
            quoteLines.push(lines[i].trim().substring(1).trim());
            i++;
          }
          blocks.push({ type: 'blockquote', runs: parseInlineRuns(quoteLines.join(' ')) });
          continue;
        }

        if (line.trim() === '') {
          i++;
          continue;
        }

        var headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          blocks.push({
            type: 'heading',
            level: headingMatch[1].length,
            runs: parseInlineRuns(headingMatch[2].trim())
          });
          i++;
          continue;
        }

        if (
          /^---+$/.test(line.trim()) ||
          /^\*\*\*+$/.test(line.trim()) ||
          /^___+$/.test(line.trim())
        ) {
          blocks.push({ type: 'hr' });
          i++;
          continue;
        }

        var ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
        if (ulMatch) {
          blocks.push({ type: 'listitem', ordered: false, runs: parseInlineRuns(ulMatch[1]) });
          i++;
          continue;
        }

        var olMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
        if (olMatch) {
          blocks.push({
            type: 'listitem',
            ordered: true,
            number: parseInt(olMatch[1], 10),
            runs: parseInlineRuns(olMatch[2])
          });
          i++;
          continue;
        }

        blocks.push({ type: 'paragraph', runs: parseInlineRuns(line) });
        i++;
      }
      return blocks;
    }

    // --------------------------------------------------------------------- //
    // Markdown blocks -> OOXML paragraphs. No named styles/numbering part —
    // headings are direct-formatted (bold + explicit w:sz), list items get a
    // plain bullet/number text prefix rather than real w:numPr numbering,
    // mirroring csv-to-xlsx.js's "no styles" minimal-parts philosophy.
    // --------------------------------------------------------------------- //

    function escapeXml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    }

    function runXml(run) {
      var props = '';
      if (run.bold) props += '<w:b/>';
      if (run.italic) props += '<w:i/>';
      if (run.code) props += '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>';
      if (run.size) props += '<w:sz w:val="' + run.size * 2 + '"/>';
      var rPr = props ? '<w:rPr>' + props + '</w:rPr>' : '';
      return '<w:r>' + rPr + '<w:t xml:space="preserve">' + escapeXml(run.text) + '</w:t></w:r>';
    }

    function paragraphXml(runsXml, pPr) {
      return '<w:p>' + (pPr || '') + runsXml + '</w:p>';
    }

    function blockToParagraphXml(block) {
      if (block.type === 'heading') {
        var size = HEADING_SIZES[block.level] || 12;
        var headingRuns = block.runs.map(function (r) {
          return { text: r.text, bold: true, italic: r.italic, code: r.code, size: size };
        });
        return paragraphXml(headingRuns.map(runXml).join(''));
      }
      if (block.type === 'paragraph') {
        return paragraphXml(block.runs.map(runXml).join(''));
      }
      if (block.type === 'listitem') {
        var prefix = block.ordered ? block.number + '. ' : String.fromCharCode(8226) + ' ';
        var itemRuns = [{ text: prefix, bold: false, italic: false, code: false }].concat(
          block.runs
        );
        return paragraphXml(itemRuns.map(runXml).join(''), LIST_QUOTE_INDENT);
      }
      if (block.type === 'blockquote') {
        var quoteRuns = block.runs.map(function (r) {
          return { text: r.text, bold: r.bold, italic: true, code: r.code };
        });
        return paragraphXml(quoteRuns.map(runXml).join(''), LIST_QUOTE_INDENT);
      }
      if (block.type === 'code') {
        return block.lines
          .map(function (line) {
            return paragraphXml(runXml({ text: line, bold: false, italic: false, code: true }));
          })
          .join('');
      }
      if (block.type === 'hr') {
        return (
          '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" ' +
          'w:color="999999"/></w:pBdr></w:pPr></w:p>'
        );
      }
      return '';
    }

    // --------------------------------------------------------------------- //
    // Minimal OOXML WordprocessingML part set — just enough for a valid
    // .docx: [Content_Types].xml, _rels/.rels, word/document.xml, and its
    // (empty) relationships part. No styles.xml, no numbering.xml.
    // --------------------------------------------------------------------- //

    function documentXml(bodyXml) {
      return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        bodyXml +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
        '</w:sectPr></w:body></w:document>'
      );
    }

    function contentTypesXml() {
      return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
      );
    }

    function rootRelsXml() {
      return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
      );
    }

    function documentRelsXml() {
      return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
      );
    }

    function buildDocx(bodyXml) {
      return buildZip([
        { name: '[Content_Types].xml', content: contentTypesXml() },
        { name: '_rels/.rels', content: rootRelsXml() },
        { name: 'word/document.xml', content: documentXml(bodyXml) },
        { name: 'word/_rels/document.xml.rels', content: documentRelsXml() }
      ]);
    }

    // --------------------------------------------------------------------- //
    // Minimal ZIP writer — "stored" (uncompressed) entries only, copied from
    // csv-to-xlsx.js's buildZip(). A valid ZIP doesn't require DEFLATE; every
    // reader (Word/LibreOffice/Google Docs unzip .docx the same as any other
    // .zip) accepts stored entries.
    // --------------------------------------------------------------------- //

    function buildCrcTable() {
      var table = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
      }
      return table;
    }

    function crc32(bytes, table) {
      var crc = 0xffffffff;
      for (var i = 0; i < bytes.length; i++) {
        crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    }

    function utf8Bytes(str) {
      return new TextEncoder().encode(str);
    }

    function u16(view, offset, value) {
      view.setUint16(offset, value, true);
    }
    function u32(view, offset, value) {
      view.setUint32(offset, value, true);
    }

    function buildZip(files) {
      var CRC_TABLE = buildCrcTable();
      var dosTime = 0;
      var dosDate = (1 << 5) | 1; // day 1, month 1, year 1980

      var localParts = [];
      var centralParts = [];
      var offset = 0;

      files.forEach(function (file) {
        var nameBytes = utf8Bytes(file.name);
        var dataBytes = utf8Bytes(file.content);
        var crc = crc32(dataBytes, CRC_TABLE);

        var localHeader = new ArrayBuffer(30);
        var lv = new DataView(localHeader);
        u32(lv, 0, 0x04034b50);
        u16(lv, 4, 20);
        u16(lv, 6, 0);
        u16(lv, 8, 0);
        u16(lv, 10, dosTime);
        u16(lv, 12, dosDate);
        u32(lv, 14, crc);
        u32(lv, 18, dataBytes.length);
        u32(lv, 22, dataBytes.length);
        u16(lv, 26, nameBytes.length);
        u16(lv, 28, 0);

        localParts.push(new Uint8Array(localHeader), nameBytes, dataBytes);

        var centralHeader = new ArrayBuffer(46);
        var cv = new DataView(centralHeader);
        u32(cv, 0, 0x02014b50);
        u16(cv, 4, 20);
        u16(cv, 6, 20);
        u16(cv, 8, 0);
        u16(cv, 10, 0);
        u16(cv, 12, dosTime);
        u16(cv, 14, dosDate);
        u32(cv, 16, crc);
        u32(cv, 20, dataBytes.length);
        u32(cv, 24, dataBytes.length);
        u16(cv, 28, nameBytes.length);
        u16(cv, 30, 0);
        u16(cv, 32, 0);
        u16(cv, 34, 0);
        u16(cv, 36, 0);
        u32(cv, 38, 0);
        u32(cv, 42, offset);

        centralParts.push(new Uint8Array(centralHeader), nameBytes);

        offset += localHeader.byteLength + nameBytes.length + dataBytes.length;
      });

      var centralStart = offset;
      var centralSize = centralParts.reduce(function (sum, part) {
        return sum + part.length;
      }, 0);

      var endRecord = new ArrayBuffer(22);
      var ev = new DataView(endRecord);
      u32(ev, 0, 0x06054b50);
      u16(ev, 4, 0);
      u16(ev, 6, 0);
      u16(ev, 8, files.length);
      u16(ev, 10, files.length);
      u32(ev, 12, centralSize);
      u32(ev, 16, centralStart);
      u16(ev, 20, 0);

      var allParts = localParts.concat(centralParts, [new Uint8Array(endRecord)]);
      var totalLength = allParts.reduce(function (sum, part) {
        return sum + part.length;
      }, 0);
      var result = new Uint8Array(totalLength);
      var pos = 0;
      allParts.forEach(function (part) {
        result.set(part, pos);
        pos += part.length;
      });
      return result;
    }
  };
})();
