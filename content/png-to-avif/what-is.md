## What Is AVIF?

AVIF (AV1 Image File Format) is a modern image format built on the AV1 video codec, developed by the Alliance for Open Media (AOMedia). It supports transparency, HDR, wide color gamut, and up to 12-bit color depth, and typically produces significantly smaller files than PNG — especially for photographic content.

Google has indexed AVIF images since April 2024, and over 93% of browsers in use today can display it natively.

### Why Convert PNG to AVIF?

PNG's lossless compression makes it reliable but often much larger than it needs to be, especially for photos or complex images saved as PNG rather than JPG. AVIF can preserve the same transparency while cutting file size dramatically, which speeds up page loads and reduces storage and bandwidth use.

### How This Tool Works

This converter runs entirely in your browser using a real libavif encoder compiled to WebAssembly — the same AV1-based encoding technology used to produce AVIF files elsewhere. Your PNG is decoded, re-encoded as AVIF at the quality level you choose with transparency preserved, and never uploaded to any server. AVIF encoding is more computationally demanding than older formats, so larger images or higher quality settings take longer to process — often several seconds for large images.
