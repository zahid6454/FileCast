(function () {
  'use strict';

  // Byte-preserving metadata strip: walk each format's own container/segment
  // structure and drop only the chunks/segments that carry EXIF/IPTC/XMP
  // metadata, leaving every other byte (including the compressed image data
  // itself) untouched. No re-encoding, so there's no quality loss and no
  // color-profile change — unlike a canvas round trip, which strips metadata
  // only as a side effect while also re-compressing the pixels.

  window.convertFile = function (file) {
    return file.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      var config = window.TOOL_CONFIG;

      if (isJpeg(bytes)) {
        if (config) config.output_extension = '.jpg';
        return new Blob(stripJpegMetadata(buffer), { type: 'image/jpeg' });
      }
      if (isPng(bytes)) {
        if (config) config.output_extension = '.png';
        return new Blob(stripPngMetadata(buffer), { type: 'image/png' });
      }
      if (isWebp(bytes)) {
        if (config) config.output_extension = '.webp';
        return new Blob(stripWebpMetadata(buffer), { type: 'image/webp' });
      }
      throw new Error('Unsupported image format. This tool accepts JPG, PNG, and WebP files.');
    });
  };

  function isJpeg(bytes) {
    return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  }

  var PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  function isPng(bytes) {
    if (bytes.length < PNG_SIGNATURE.length) return false;
    for (var i = 0; i < PNG_SIGNATURE.length; i++) {
      if (bytes[i] !== PNG_SIGNATURE[i]) return false;
    }
    return true;
  }

  function isWebp(bytes) {
    return (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 && // 'RIFF'
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50 // 'WEBP'
    );
  }

  // ---------------------------------------------------------------------
  // JPEG — strip APP1 (EXIF/XMP, marker 0xE1) and APP13 (Photoshop IRB,
  // which carries IPTC, marker 0xED) segments. APP0 (JFIF) and APP2 (ICC
  // color profile) are kept, so the image's on-screen color doesn't shift.
  // ---------------------------------------------------------------------
  var STRIP_JPEG_MARKERS = { 225: true, 237: true };

  function isStandaloneMarker(marker) {
    // SOI (0xD8), EOI (0xD9), TEM (0x01), and the RSTn range (0xD0-0xD7)
    // carry no length field and no payload.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) return true;
    return marker >= 0xd0 && marker <= 0xd7;
  }

  function stripJpegMetadata(buffer) {
    var view = new DataView(buffer);
    var out = [new Uint8Array(buffer, 0, 2)]; // SOI
    var offset = 2;

    while (offset < buffer.byteLength - 1) {
      if (view.getUint8(offset) !== 0xff) break; // malformed — bail, keep the rest verbatim below

      var marker = view.getUint8(offset + 1);

      if (marker === 0xd9) {
        // EOI
        out.push(new Uint8Array(buffer, offset, buffer.byteLength - offset));
        offset = buffer.byteLength;
        break;
      }

      if (isStandaloneMarker(marker)) {
        out.push(new Uint8Array(buffer, offset, 2));
        offset += 2;
        continue;
      }

      if (offset + 4 > buffer.byteLength) break;
      var length = view.getUint16(offset + 2, false); // big-endian, includes itself
      var segmentEnd = offset + 2 + length;
      if (segmentEnd > buffer.byteLength) break;

      if (!STRIP_JPEG_MARKERS[marker]) {
        out.push(new Uint8Array(buffer, offset, segmentEnd - offset));
      }

      if (marker === 0xda) {
        // SOS — entropy-coded scan data follows with no further markers to
        // strip (restart markers inside it are standalone), so copy the
        // rest of the file verbatim rather than continuing to parse it.
        out.push(new Uint8Array(buffer, segmentEnd, buffer.byteLength - segmentEnd));
        offset = buffer.byteLength;
        break;
      }

      offset = segmentEnd;
    }

    if (offset < buffer.byteLength) {
      out.push(new Uint8Array(buffer, offset, buffer.byteLength - offset));
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // PNG — drop ancillary text/EXIF chunks; every other chunk (including
  // pHYs, gAMA, cHRM, sRGB) is copied verbatim with its original CRC, since
  // only whole chunks are removed and nothing inside a kept chunk changes.
  // ---------------------------------------------------------------------
  var STRIP_PNG_CHUNKS = { tEXt: true, zTXt: true, iTXt: true, eXIf: true };

  function stripPngMetadata(buffer) {
    var view = new DataView(buffer);
    var out = [new Uint8Array(buffer, 0, 8)]; // signature
    var offset = 8;

    while (offset + 8 <= buffer.byteLength) {
      var length = view.getUint32(offset, false);
      var type = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7)
      );
      var chunkEnd = offset + 8 + length + 4; // length field + type + data + CRC
      if (chunkEnd > buffer.byteLength) break;

      if (!STRIP_PNG_CHUNKS[type]) {
        out.push(new Uint8Array(buffer, offset, chunkEnd - offset));
      }

      offset = chunkEnd;
      if (type === 'IEND') break;
    }

    if (offset < buffer.byteLength) {
      out.push(new Uint8Array(buffer, offset, buffer.byteLength - offset));
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // WebP — RIFF container. Drop EXIF/XMP chunks and patch the RIFF size
  // field (bytes 4-7) to match the new total, since unlike PNG chunks a
  // RIFF file's overall length is declared once at the top, not implied by
  // an end marker. If the file has a VP8X (extended format) chunk, its
  // flags byte also declares which optional chunks are present — leaving
  // its EXIF/XMP bits set after the chunks themselves are gone would make
  // the output non-conformant with the WebP container spec, so those two
  // bits are cleared too.
  // ---------------------------------------------------------------------
  var STRIP_WEBP_CHUNKS = { EXIF: true, 'XMP ': true };
  var VP8X_EXIF_FLAG = 0x08;
  var VP8X_XMP_FLAG = 0x04;

  function stripWebpMetadata(buffer) {
    var view = new DataView(buffer);
    var out = [new Uint8Array(buffer, 0, 12)]; // 'RIFF' + size + 'WEBP'
    var offset = 12;

    while (offset + 8 <= buffer.byteLength) {
      var fourCc = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      var size = view.getUint32(offset + 4, true); // little-endian
      var padded = size + (size % 2); // RIFF chunks are padded to an even length
      var chunkEnd = offset + 8 + padded;
      if (chunkEnd > buffer.byteLength) break;

      if (!STRIP_WEBP_CHUNKS[fourCc]) {
        out.push(new Uint8Array(buffer, offset, 8 + padded));
      }

      offset = chunkEnd;
    }

    if (offset < buffer.byteLength) {
      out.push(new Uint8Array(buffer, offset, buffer.byteLength - offset));
    }

    clearVp8xMetadataFlags(out);

    var restLength = 0;
    for (var i = 1; i < out.length; i++) restLength += out[i].byteLength;

    var header = new Uint8Array(out[0]); // copy — never mutate the source buffer
    new DataView(header.buffer).setUint32(4, restLength + 4, true); // +4 for 'WEBP'
    out[0] = header;

    return out;
  }

  function clearVp8xMetadataFlags(out) {
    for (var i = 1; i < out.length; i++) {
      var chunk = out[i];
      // 'VP8X' fourCC, plus at least 1 flags byte past the 8-byte chunk header.
      if (
        chunk.byteLength >= 9 &&
        chunk[0] === 0x56 &&
        chunk[1] === 0x50 &&
        chunk[2] === 0x38 &&
        chunk[3] === 0x58
      ) {
        var copy = new Uint8Array(chunk); // copy — this array is a view onto the source buffer
        copy[8] &= ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);
        out[i] = copy;
        return;
      }
    }
  }
})();
