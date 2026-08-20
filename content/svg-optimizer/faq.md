## Frequently Asked Questions

### Is it safe to optimize my SVG here?

Yes. This tool processes your file entirely in your browser. Your SVG is never uploaded to any server — everything happens locally on your device.

### Will optimizing change how my SVG looks?

No. This tool only removes comments, empty metadata, editor-specific attributes, and insignificant whitespace between tags — it never touches path data, shapes, colors, or styling. The rendered output is identical to the original.

### Does this do everything a tool like SVGO does?

Not everything — this tool focuses on safe, structural cleanup (comments, editor cruft, empty elements, whitespace) rather than more aggressive optimizations like rounding path-data precision or merging paths, which can occasionally cause subtle visual differences if not tuned carefully. For most exported icons and logos, the structural cleanup alone removes the bulk of the unnecessary weight.

### What if my file doesn't get any smaller?

If your SVG was already clean — no comments, no editor metadata, no extra whitespace — there may be nothing left to remove. In that case, this tool returns your original file unchanged rather than a result that's the same size or larger.

### Can I optimize an SVG that has embedded raster images or fonts?

Yes. Embedded `<image>` data and font references are left untouched — only the surrounding XML structure is cleaned up.
