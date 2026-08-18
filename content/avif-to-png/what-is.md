## What Is AVIF?

AVIF (AV1 Image File Format) is a modern image format built on the AV1 video codec, developed by the Alliance for Open Media (AOMedia). It delivers roughly 50% smaller files than JPEG at comparable visual quality, and supports transparency, HDR, wide color gamut, and up to 12-bit color depth.

Browser support for AVIF is now strong — over 93% of browsers in use today can display it — but adoption across the wider web is still under 1% of sites, so plenty of software still doesn't handle it.

### Why Convert to PNG?

PNG is the safe, universal choice whenever you need to preserve transparency and hand an image to software that doesn't understand AVIF. Design tools, older image editors, icon generators, and many upload forms all expect PNG (or JPG) rather than AVIF, and PNG's lossless compression means nothing is lost in the conversion beyond what AVIF's own encoding already discarded.

### How This Tool Works

This converter runs entirely in your browser using a real libavif decoder compiled to WebAssembly — the same underlying decode technology browsers use natively. Your AVIF file is decoded and re-encoded as a PNG entirely on your device, with any transparency preserved; it's never uploaded to any server. Larger or higher-resolution images take a little longer to process since AVIF decoding is more computationally intensive than older formats.
