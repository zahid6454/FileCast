import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createDom } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'pdf-encryption');

// The page carries real drawn text (a Flate-compressed content *stream*, not
// just dict/string metadata) specifically so these tests exercise AES stream
// decryption end to end (IV extraction + PKCS#7 unpadding), not only the
// string/dict path — an earlier version of this suite used pypdf's
// add_blank_page(), which has no content stream at all and so never actually
// ran decryptObjectBytes() against a PDFStream for the AES ciphers.
const MESSAGE = 'Hello, world! This is real content for the AES stream decrypt test.';
// pdf-lib serializes string operands as uppercase hex PDFHexStrings; matched
// against the substring rather than the whole (Flate-decompressed) content
// stream because the /Font resource name pdf-lib assigns on embed isn't
// stable across regenerations of the fixtures below.
const EXPECTED_HEX_OPERAND = Buffer.from(MESSAGE, 'latin1').toString('hex').toUpperCase();

// Fixtures generated with pdf-lib (for the plaintext, so the content stream
// is byte-for-byte what the browser's own pdf-lib would produce) then
// re-encrypted with pypdf 6.x, one per PDF Standard Security Handler
// revision this tool supports as of this test — user password "openme123",
// owner password "ownerpw456", title "A Secret Report". See
// pdf-lib-worker.js's own "PDF Standard Security Handler, revisions 3+"
// comment block for what each level means; generation kept here only as a
// comment for reproducibility:
//
//   // Node, using the vendored static/lib/pdf-lib.min.js:
//   const doc = await PDFLib.PDFDocument.create();
//   const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
//   const page = doc.addPage([200, 200]);
//   page.drawText(MESSAGE, { x: 10, y: 100, size: 10, font });
//   doc.setTitle('A Secret Report');
//   fs.writeFileSync('plaintext-source.pdf', await doc.save());
//
//   # Python, pypdf 6.x — clone_from preserves the content stream's raw bytes:
//   from pypdf import PdfWriter
//   w = PdfWriter(clone_from="plaintext-source.pdf")
//   w.encrypt(user_password="openme123", owner_password="ownerpw456", algorithm=ALGO)
//   # ALGO in {"RC4-40", "RC4-128", "AES-128", "AES-256-R5", "AES-256"}
const LEVELS = [
  { file: 'rc4-40-r2.pdf', label: 'RC4-40 (V1/R2)' },
  { file: 'rc4-128-r3.pdf', label: 'RC4-128 (V2/R3)' },
  { file: 'aes-128-r4.pdf', label: 'AES-128 (V4/R4)' },
  { file: 'aes-256-r5.pdf', label: 'AES-256, deprecated (V5/R5)' },
  { file: 'aes-256-r6.pdf', label: 'AES-256, ISO 32000-2 (V5/R6)' }
];

function evalStrippingUseStrict(dom, absPath) {
  const src = fs.readFileSync(absPath, 'utf8').replace(/^\s*(['"])use strict\1;\s*\n/, '');
  dom.window.eval(src);
}

function loadPdfLibWorkerGlobals() {
  const dom = createDom();
  evalStrippingUseStrict(dom, path.join(ROOT, 'static', 'lib', 'pdf-lib.min.js'));
  evalStrippingUseStrict(dom, path.join(ROOT, 'static', 'js', 'workers', 'pdf-lib-worker.js'));
  return dom;
}

// The one content stream in these single-page fixtures — pdf-lib's own
// getContents() returns the raw (still Flate-compressed) bytes, so this
// inflates them the same way a real PDF reader would.
function decompressedPageContent(dom, doc) {
  const ctx = doc.context;
  let streamObj = null;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof dom.window.PDFLib.PDFStream) streamObj = obj;
  }
  expect(streamObj).not.toBeNull();
  return inflateSync(Buffer.from(streamObj.getContents())).toString('latin1');
}

describe('pdf-lib-worker.js — unlock() across PDF Standard Security Handler revisions', () => {
  for (const { file, label } of LEVELS) {
    it(`unlocks a real ${label} PDF with the correct user password, content stream included`, async () => {
      const dom = loadPdfLibWorkerGlobals();
      // pdf-lib's own `instanceof Uint8Array` check requires a Uint8Array
      // from *this* jsdom realm, not Node's — see the makeTestPdf() comment
      // in pdf-lib-worker-crypto.test.js for the same cross-realm gotcha.
      const bytes = new dom.window.Uint8Array(fs.readFileSync(path.join(FIXTURES, file)));

      const result = await dom.window.unlock(bytes, 'openme123');
      const reloaded = await dom.window.PDFLib.PDFDocument.load(result.bytes);

      expect(reloaded.getPageCount()).toBe(1);
      expect(reloaded.getTitle()).toBe('A Secret Report');
      expect(decompressedPageContent(dom, reloaded)).toContain(EXPECTED_HEX_OPERAND);
    });

    it(`rejects the wrong password for a ${label} PDF`, async () => {
      const dom = loadPdfLibWorkerGlobals();
      const bytes = new dom.window.Uint8Array(fs.readFileSync(path.join(FIXTURES, file)));

      await expect(dom.window.unlock(bytes, 'wrongpassword')).rejects.toThrow(
        /incorrect password/i
      );
    });
  }
});
