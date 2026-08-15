import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDom } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// A leading top-level 'use strict' directive gives `eval()` its own isolated
// variable environment (real JS eval semantics, not a jsdom quirk — verified
// against plain Node/jsdom eval() directly): every function/var declared at
// the top of the evaluated text stays invisible outside that one eval() call,
// even via indirect eval like `dom.window.eval()`. Inside a real Worker this
// is a non-issue (pdf-lib-worker.js's own top-level code calls its own
// functions by identifier, never via `self.foo`), but a test that wants to
// reach those functions from outside needs them to land on `dom.window` —
// so the directive is stripped from this in-memory copy only; the shipped
// file is untouched.
function evalStrippingUseStrict(dom, absPath) {
  const src = fs.readFileSync(absPath, 'utf8').replace(/^\s*(['"])use strict\1;\s*\n/, '');
  dom.window.eval(src);
}

// Dedicated tests for the RC4/40-bit Standard Security Handler hand-rolled in
// pdf-lib-worker.js (protect/unlock ops) — pdf-lib itself has no encryption
// support at all, so this is new cryptography, not a thin wrapper around a
// library the ecosystem has already exercised. Every existing worker op
// (merge/split/rotate) has zero direct tests today — only their converter.js
// wrappers are tested, via a fake Worker — but a security-sensitive feature
// gets a higher bar here: these load the real pdf-lib.min.js and the real
// worker script into jsdom and call the worker's internal functions directly.
//
// The O/U/key test vectors below were cross-checked against pypdf's own
// implementation of the same ISO 32000-1 §7.6.3 algorithms (Algorithm 2/3/4)
// for the same password/permissions/ID inputs, confirmed byte-for-byte
// identical during development. A full round trip (encrypt then decrypt
// recovers the original page count/title, and a real independent reader —
// pypdf — can open the encrypted output with the correct password and
// rejects the wrong one) was also verified against pypdf outside this suite.

function loadPdfLibWorkerGlobals() {
  const dom = createDom();
  evalStrippingUseStrict(dom, path.join(ROOT, 'static', 'lib', 'pdf-lib.min.js'));
  evalStrippingUseStrict(dom, path.join(ROOT, 'static', 'js', 'workers', 'pdf-lib-worker.js'));
  return dom;
}

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

describe('pdf-lib-worker.js — Standard Security Handler primitives', () => {
  it('matches pypdf reference vectors for owner key / O / file key / U (RC4-40, R2)', () => {
    const dom = loadPdfLibWorkerGlobals();
    const password = new TextEncoder().encode('secret123');
    const P = -4;
    const id1 = new Uint8Array(Array.from({ length: 16 }, (_, i) => i));

    const ownerKey = dom.window.computeOwnerKey(password);
    const O = dom.window.computeOValue(ownerKey, password);
    const fileKey = dom.window.computeFileKey(password, O, P, id1);
    const U = dom.window.computeUValue(fileKey);

    expect(hex(ownerKey)).toBe('6ef27f7a89');
    expect(hex(O)).toBe('2130f104d56787a97bcf3c635aa12a0dfe0641dd618844fb24b9db5359751005');
    expect(hex(fileKey)).toBe('f886ce9fe6');
    expect(hex(U)).toBe('4e9fc3546afadac1b393cc21a0266ebcd73c921de2edd85a25e7f7f4fba08e01');
  });

  it('rc4 is its own inverse', () => {
    const dom = loadPdfLibWorkerGlobals();
    const key = new TextEncoder().encode('a-key');
    const plaintext = new TextEncoder().encode('The quick brown fox jumps over the lazy dog.');
    const ciphertext = dom.window.rc4(key, plaintext);
    const roundTrip = dom.window.rc4(key, ciphertext);
    expect(Array.from(roundTrip)).toEqual(Array.from(plaintext));
    expect(Array.from(ciphertext)).not.toEqual(Array.from(plaintext));
  });
});

describe('pdf-lib-worker.js — protect() / unlock()', () => {
  async function makeTestPdf(dom) {
    // No explicit page-size array here: a plain `[w, h]` literal created in
    // this test's own realm fails pdf-lib's `instanceof Array` check against
    // dom.window's own Array constructor — jsdom gives each window a
    // distinct Array/Object per DOM realm semantics, unlike the shared
    // Uint8Array/TypedArray globals the rest of this file relies on.
    // addPage() with no args uses pdf-lib's default page size, which this
    // test doesn't care about anyway.
    const doc = await dom.window.PDFLib.PDFDocument.create();
    const font = await doc.embedFont(dom.window.PDFLib.StandardFonts.Helvetica);
    const page = doc.addPage();
    page.drawText('Hello, world', { x: 50, y: 150, size: 14, font });
    doc.setTitle('A Secret Report');
    return doc.save();
  }

  it('round-trips: protect() then unlock() with the right password recovers the document', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const plainBytes = await makeTestPdf(dom);

    const protectResult = await dom.window.protect(plainBytes, 'openme');
    expect(protectResult.bytes.length).toBeGreaterThan(0);

    const unlockResult = await dom.window.unlock(protectResult.bytes, 'openme');
    const reloaded = await dom.window.PDFLib.PDFDocument.load(unlockResult.bytes);
    expect(reloaded.getPageCount()).toBe(1);
    expect(reloaded.getTitle()).toBe('A Secret Report');
  });

  it('rejects the wrong password', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const plainBytes = await makeTestPdf(dom);
    const protectResult = await dom.window.protect(plainBytes, 'openme');

    await expect(dom.window.unlock(protectResult.bytes, 'wrongpassword')).rejects.toThrow(
      /incorrect password/i
    );
  });

  it('reports that a password is needed when none is supplied for a user-password-protected PDF', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const plainBytes = await makeTestPdf(dom);
    const protectResult = await dom.window.protect(plainBytes, 'openme');

    await expect(dom.window.unlock(protectResult.bytes, '')).rejects.toThrow(
      /requires a password to unlock/i
    );
  });

  it('protect() rejects when no password is given', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const plainBytes = await makeTestPdf(dom);
    await expect(dom.window.protect(plainBytes, '')).rejects.toThrow(/enter a password/i);
  });

  it('unlock() rejects a PDF that is not password-protected', async () => {
    const dom = loadPdfLibWorkerGlobals();
    const plainBytes = await makeTestPdf(dom);
    await expect(dom.window.unlock(plainBytes, '')).rejects.toThrow(/not password-protected/i);
  });
});
