## What Is AVIF?

AVIF (AV1 Image File Format) is a modern image format built on the AV1 video codec, developed by the Alliance for Open Media (AOMedia) — the same group behind Netflix, Google, and Amazon's video compression work. It typically produces files around 50% smaller than JPEG at comparable visual quality, and supports HDR, wide color gamut, and up to 12-bit color depth.

Google has indexed AVIF images since April 2024, and over 93% of browsers in use today can display it natively.

### Why Convert JPG to AVIF?

If you're publishing images to the web, smaller files mean faster page loads — a factor search engines and Core Web Vitals scoring both reward. Converting your existing JPG photos to AVIF can meaningfully cut their file size without a visible drop in quality, which adds up quickly across a whole site's worth of images.

### How This Tool Works

This converter runs entirely in your browser using a real libavif encoder compiled to WebAssembly — the same AV1-based encoding technology used to produce AVIF files elsewhere. Your JPG is decoded, re-encoded as AVIF at the quality level you choose, and never uploaded to any server. AVIF encoding is more computationally demanding than older formats, so larger images or higher quality settings take longer to process — often several seconds for large photos.
