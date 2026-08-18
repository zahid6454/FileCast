## What Is AVIF?

AVIF (AV1 Image File Format) is a modern image format built on the AV1 video codec, developed by the Alliance for Open Media (AOMedia) — the same group behind Netflix, Google, and Amazon's video compression work. It delivers roughly 50% smaller files than JPEG at comparable visual quality, and supports features JPEG never could: transparency, HDR, wide color gamut, and up to 12-bit color depth.

Browser support for AVIF is now strong — over 93% of browsers in use today can display it, and it's built into every major engine (Chrome, Firefox, Edge, Safari 16.4+). WordPress added native AVIF support in version 6.5.

### Why Convert to JPG?

Despite that browser support, AVIF adoption across the wider web is still under 1% of sites. Plenty of software still doesn't handle it: some photo editors, older CMS platforms, certain printing services, and a fair amount of legacy business software either reject AVIF uploads outright or fail to open the file at all.

JPG, on the other hand, works everywhere it has for decades — every device, editor, printer, and platform accepts it without a second thought.

### How This Tool Works

This converter runs entirely in your browser using a real libavif decoder compiled to WebAssembly — the same underlying decode technology browsers use natively. Your AVIF file is decoded and re-encoded as a JPG entirely on your device; it's never uploaded to any server. Larger or higher-resolution images take a little longer to process since AVIF decoding is more computationally intensive than older formats.
