import { describe, expect, it } from 'vitest';
import { createDom, evalScript } from './helpers.js';

function concatBytes(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function bytesOf(str) {
  return Array.from(str).map((c) => c.charCodeAt(0));
}

// A minimal-but-structurally-real JPEG: SOI, an APP0/JFIF segment (kept), an
// APP1/EXIF segment (must be stripped), an SOS header, fake entropy-coded
// data, and EOI.
function buildFakeJpeg() {
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10,
    ...new Array(14).fill(0), // APP0 (JFIF) — length 16, kept
    0xff,
    0xe1,
    0x00,
    0x08,
    ...bytesOf('Exif'),
    0x00,
    0x00, // APP1 (EXIF) — length 8, must be stripped
    0xff,
    0xda,
    0x00,
    0x08,
    1,
    2,
    3,
    4,
    5,
    6, // SOS header — length 8, kept
    0xab,
    0xcd,
    0xef, // fake entropy-coded scan data
    0xff,
    0xd9 // EOI
  ]);
}

function buildFakePng() {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [0, 0, 0, 13, ...bytesOf('IHDR'), ...new Array(13).fill(0), 0, 0, 0, 0];
  const text = [0, 0, 0, 5, ...bytesOf('tEXt'), ...bytesOf('hello'), 0, 0, 0, 0];
  const iend = [0, 0, 0, 0, ...bytesOf('IEND'), 0, 0, 0, 0];
  return new Uint8Array([...signature, ...ihdr, ...text, ...iend]);
}

function chunkBytes(fourCc, dataBytes) {
  const size = dataBytes.length;
  const padded = size % 2 === 0 ? dataBytes : [...dataBytes, 0];
  return [
    ...bytesOf(fourCc),
    size & 0xff,
    (size >> 8) & 0xff,
    (size >> 16) & 0xff,
    (size >> 24) & 0xff,
    ...padded
  ];
}

function buildFakeWebp() {
  const fake = chunkBytes('FAKE', bytesOf('data')); // kept, 4-byte payload
  const exif = chunkBytes('EXIF', bytesOf('EXIFDA')); // stripped, 6-byte payload
  const restLength = 4 /* 'WEBP' */ + fake.length + exif.length;
  const header = [
    ...bytesOf('RIFF'),
    restLength & 0xff,
    (restLength >> 8) & 0xff,
    (restLength >> 16) & 0xff,
    (restLength >> 24) & 0xff,
    ...bytesOf('WEBP')
  ];
  return new Uint8Array([...header, ...fake, ...exif]);
}

describe('image-exif-remover.js — window.convertFile', () => {
  it('strips only the APP1/EXIF segment from a JPEG, leaving everything else byte-identical', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/image-exif-remover.js');

    const original = buildFakeJpeg();
    const file = new dom.window.File([original], 'photo.jpg', { type: 'image/jpeg' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/jpeg');
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // The APP1/EXIF segment (10 bytes: FF E1 00 08 + 6-byte "Exif\0\0") is gone.
    expect(bytes.length).toBe(original.length - 10);
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).not.toContain('Exif');

    // SOI, APP0 (JFIF), SOS, and EOI all survive untouched.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes[bytes.length - 2]).toBe(0xff);
    expect(bytes[bytes.length - 1]).toBe(0xd9);
    expect(Array.from(bytes.slice(2, 4))).toEqual([0xff, 0xe0]); // APP0 kept
  });

  it('strips only ancillary text chunks from a PNG, leaving IHDR/IEND untouched', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/image-exif-remover.js');

    const original = buildFakePng();
    const file = new dom.window.File([original], 'graphic.png', { type: 'image/png' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(bytes.length).toBe(original.length - 17); // the tEXt chunk (17 bytes) is gone
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).not.toContain('hello');
    expect(text).toContain('IHDR');
    expect(text).toContain('IEND');
  });

  it('strips the EXIF chunk from a WebP and patches the RIFF size field', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/image-exif-remover.js');

    const original = buildFakeWebp();
    const file = new dom.window.File([original], 'photo.webp', { type: 'image/webp' });
    const blob = await dom.window.convertFile(file);

    expect(blob.type).toBe('image/webp');
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    const text = Buffer.from(bytes).toString('latin1');
    expect(text).not.toContain('EXIFDA');
    expect(text).toContain('FAKE');

    // RIFF size field = total file size - 8, recomputed after the EXIF chunk was dropped.
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  });

  it('rejects a file that is none of JPEG, PNG, or WebP', async () => {
    const dom = createDom();
    evalScript(dom, 'converters/image-exif-remover.js');

    const file = new dom.window.File([new Uint8Array([1, 2, 3, 4])], 'weird.bin', {
      type: 'application/octet-stream'
    });
    await expect(dom.window.convertFile(file)).rejects.toThrow(/unsupported image format/i);
  });
});
