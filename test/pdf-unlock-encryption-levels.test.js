import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDom } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'pdf-encryption');

// Fixtures generated with pypdf 6.x (`PdfWriter.encrypt(..., algorithm=...)`),
// one per PDF Standard Security Handler revision this tool supports as of
// this test — user password "openme123", owner password "ownerpw456",
// title "A Secret Report". See pdf-lib-worker.js's own "PDF Standard
// Security Handler, revisions 3+" comment block for what each level means;
// generation script kept only in this comment for reproducibility:
//
//   from pypdf import PdfWriter
//   w = PdfWriter()
//   w.add_blank_page(width=200, height=200)
//   w.add_metadata({"/Title": "A Secret Report"})
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

describe('pdf-lib-worker.js — unlock() across PDF Standard Security Handler revisions', () => {
  for (const { file, label } of LEVELS) {
    it(`unlocks a real ${label} PDF with the correct user password`, async () => {
      const dom = loadPdfLibWorkerGlobals();
      // pdf-lib's own `instanceof Uint8Array` check requires a Uint8Array
      // from *this* jsdom realm, not Node's — see the makeTestPdf() comment
      // in pdf-lib-worker-crypto.test.js for the same cross-realm gotcha.
      const bytes = new dom.window.Uint8Array(fs.readFileSync(path.join(FIXTURES, file)));

      const result = await dom.window.unlock(bytes, 'openme123');
      const reloaded = await dom.window.PDFLib.PDFDocument.load(result.bytes);

      expect(reloaded.getPageCount()).toBe(1);
      expect(reloaded.getTitle()).toBe('A Secret Report');
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
