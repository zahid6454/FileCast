## Frequently Asked Questions

### Is it safe to convert my images here?

Yes. This tool encodes your PNG as AVIF entirely in your browser, using a WebAssembly build of libavif. Your image is never uploaded to a server — when you close the tab, all data is gone.

### What does the quality slider actually control?

It controls how much detail the AVIF encoder keeps versus how small the resulting file is. Higher quality produces a larger, more faithful file; lower quality produces a smaller file with more compression artifacts. The default (65%) is a reasonable balance for most images — try 80–90% if you notice visible quality loss, especially on graphics with sharp edges or text.

### Is transparency preserved?

Yes. AVIF supports an alpha channel, so any transparency in your original PNG carries over to the converted file.

### Why does conversion take longer than converting to JPG or WebP?

AVIF encoding is genuinely more computationally intensive than older formats — it's doing real AV1-based video-codec-derived compression, not a simpler algorithm. Larger images and higher quality settings both increase processing time, sometimes to several seconds for large images. This all happens on your device; there's no upload involved.

### Can I convert multiple PNG files at once?

Currently, this tool converts one file at a time. Drop a file, convert it, download, then click "Convert Another" for the next one. Batch conversion is planned for a future update.
