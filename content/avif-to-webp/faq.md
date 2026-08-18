## Frequently Asked Questions

### Is it safe to convert my images here?

Yes. This tool decodes and re-encodes your AVIF file entirely in your browser, using a WebAssembly build of the same libavif decoder browsers use natively. Your image is never uploaded to a server — when you close the tab, all data is gone.

### Does converting to WebP reduce image quality?

Slightly. WebP is used here in lossy mode at a quality setting tuned for a good balance of size and visual fidelity, so there's a small amount of re-compression on top of whatever quality loss the AVIF encoding already introduced.

### Is transparency preserved?

Yes. WebP supports an alpha channel, so any transparency in your original AVIF image carries over to the converted file.

### Will the file size increase after conversion?

Often, yes, though usually less than converting to JPG or PNG would. AVIF is typically the more efficient of the two formats, so expect some increase, but WebP still compresses well compared to older formats.

### Why does conversion take a moment for some files?

AVIF decoding is more computationally intensive than older formats. Larger or higher-resolution images take longer to process. Everything still happens on your device — there's no upload involved, just more work for your browser to do.
