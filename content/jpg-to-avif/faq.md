## Frequently Asked Questions

### Is it safe to convert my photos here?

Yes. This tool encodes your JPG as AVIF entirely in your browser, using a WebAssembly build of libavif. Your image is never uploaded to a server — when you close the tab, all data is gone.

### What does the quality slider actually control?

It controls how much detail the AVIF encoder keeps versus how small the resulting file is. Higher quality produces a larger, more faithful file; lower quality produces a smaller file with more compression artifacts. The default (65%) is a reasonable balance for most photos — try 80–90% if you notice visible quality loss.

### Why does conversion take longer than converting to JPG or WebP?

AVIF encoding is genuinely more computationally intensive than older formats — it's doing real AV1-based video-codec-derived compression, not a simpler algorithm. Larger images and higher quality settings both increase processing time, sometimes to several seconds for large photos. This all happens on your device; there's no upload involved.

### Will everyone be able to open the AVIF file I download?

Most people, yes — AVIF is supported by all major browsers and is well over 93% of browsers in current use. Some older software, certain photo editors, and a handful of platforms still don't support it, so it's worth checking your intended destination if you're unsure.

### Can I convert multiple JPG files at once?

Currently, this tool converts one file at a time. Drop a file, convert it, download, then click "Convert Another" for the next one. Batch conversion is planned for a future update.
