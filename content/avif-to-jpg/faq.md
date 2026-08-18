## Frequently Asked Questions

### Is it safe to convert my photos here?

Yes. This tool decodes and re-encodes your AVIF file entirely in your browser, using a WebAssembly build of the same libavif decoder browsers use natively. Your image is never uploaded to a server — when you close the tab, all data is gone.

### Does converting to JPG reduce image quality?

Slightly. JPG is a lossy format, so there's a small quality reduction during re-encoding. This tool uses a 92% quality setting, which produces JPG files that are visually indistinguishable from the original in normal viewing.

### What happens to transparency in my AVIF image?

JPG doesn't support transparency. If your AVIF image has transparent areas, they'll be filled with a white background in the converted JPG. If you need to keep transparency, use [AVIF to PNG](/convert/avif-to-png/) instead.

### Will the file size increase after conversion?

Usually, yes. AVIF is significantly more efficient than JPEG, so converting typically increases file size — often by a large margin for the same visual quality. This is expected; you're trading AVIF's compression efficiency for JPG's universal compatibility.

### Why does conversion take a moment for some files?

AVIF decoding is more computationally intensive than older formats like JPEG. Larger or higher-resolution images take longer to process. Everything still happens on your device — there's no upload involved, just more work for your browser to do.
