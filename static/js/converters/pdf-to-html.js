(function () {
  'use strict';

  window.convertFile = function (file) {
    var config = window.TOOL_CONFIG || {};
    if (config.pdf_worker_src) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = config.pdf_worker_src;
    }

    return file
      .arrayBuffer()
      .then(function (bytes) {
        var loadingTask = pdfjsLib.getDocument({ data: bytes });
        return loadingTask.promise;
      })
      .then(function (pdfDoc) {
        var pageCount = pdfDoc.numPages;
        var chain = Promise.resolve();
        var pagesHtml = [];
        var foundText = false;

        for (var i = 1; i <= pageCount; i++) {
          (function (pageNum) {
            chain = chain
              .then(function () {
                return extractPageParagraphs(pdfDoc, pageNum);
              })
              .then(function (paragraphs) {
                if (paragraphs.length) foundText = true;
                pagesHtml.push(renderPage(paragraphs, pageNum));
              });
          })(i);
        }

        return chain.then(function () {
          if (!foundText) {
            throw new Error(
              'No text found in this PDF. It may be a scanned or image-based document with no selectable text.'
            );
          }
          var title = escapeHtml(file.name.replace(/\.pdf$/i, ''));
          var html = buildDocument(title, pagesHtml.join('\n'));
          return new Blob([html], { type: 'text/html' });
        });
      });
  };

  function extractPageParagraphs(pdfDoc, pageNum) {
    return pdfDoc.getPage(pageNum).then(function (page) {
      return page.getTextContent().then(function (textContent) {
        var paragraphs = [];
        var current = '';
        textContent.items.forEach(function (item) {
          current += item.str;
          if (item.hasEOL) {
            if (current.trim()) paragraphs.push(current.trim());
            current = '';
          } else {
            current += ' ';
          }
        });
        if (current.trim()) paragraphs.push(current.trim());
        return paragraphs;
      });
    });
  }

  function renderPage(paragraphs, pageNum) {
    var body = paragraphs
      .map(function (p) {
        return '<p>' + escapeHtml(p) + '</p>';
      })
      .join('\n');
    return '<section class="pdf-page" data-page="' + pageNum + '">\n' + body + '\n</section>';
  }

  function buildDocument(title, bodyHtml) {
    return (
      '<!DOCTYPE html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<title>' +
      title +
      '</title>\n' +
      '<style>\n' +
      'body{font-family:Georgia,serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#222}\n' +
      '.pdf-page{margin-bottom:2.5rem;padding-bottom:1.5rem;border-bottom:1px solid #ddd}\n' +
      '.pdf-page:last-child{border-bottom:none}\n' +
      'p{margin:0 0 1em}\n' +
      '</style>\n' +
      '</head>\n' +
      '<body>\n' +
      bodyHtml +
      '\n</body>\n' +
      '</html>\n'
    );
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
