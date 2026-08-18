## Frequently Asked Questions

### Is it safe to convert my images here?

Yes. This tool decodes and re-encodes your AVIF file entirely in your browser, using a WebAssembly build of the same libavif decoder browsers use natively. Your image is never uploaded to a server — when you close the tab, all data is gone.

### Does converting to PNG reduce image quality?

No. PNG is a lossless format, so the pixel data from the decoded AVIF is preserved exactly. Any quality loss already happened when the image was originally encoded as AVIF — converting to PNG doesn't add any further loss.

### Is transparency preserved?

Yes. Unlike converting to JPG, converting AVIF to PNG keeps any alpha channel (transparency) in your original image fully intact.

### Will the file size increase after conversion?

Usually, yes, and often significantly. AVIF is a much more efficient compression format than PNG, especially for photographic content, so converting typically produces a noticeably larger file for the same image.

### Why does conversion take a moment for some files?

AVIF decoding is more computationally intensive than older formats. Larger or higher-resolution images take longer to process. Everything still happens on your device — there's no upload involved, just more work for your browser to do.
