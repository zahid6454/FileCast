## What Is AVIF?

AVIF (AV1 Image File Format) is a modern image format built on the AV1 video codec, developed by the Alliance for Open Media (AOMedia). It delivers roughly 50% smaller files than JPEG at comparable visual quality, and supports transparency, HDR, wide color gamut, and up to 12-bit color depth.

Browser support for AVIF is now strong — over 93% of browsers in use today can display it — but adoption across the wider web is still under 1% of sites, well behind the older, more established WebP format.

### Why Convert to WebP?

WebP has been around for longer and has broader real-world support across content management systems, CDNs, image-optimization pipelines, and older browser versions that don't yet handle AVIF. If a platform you're publishing to accepts WebP but not AVIF, or you want a format with a longer compatibility track record while still keeping most of the file-size savings over JPEG or PNG, WebP is the practical middle ground.

### How This Tool Works

This converter runs entirely in your browser using a real libavif decoder compiled to WebAssembly — the same underlying decode technology browsers use natively. Your AVIF file is decoded and re-encoded as a WebP entirely on your device, with any transparency preserved; it's never uploaded to any server. Larger or higher-resolution images take a little longer to process since AVIF decoding is more computationally intensive than older formats.
