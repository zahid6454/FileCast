## The Direction You Resize In Matters

Take a small image and blow it up to fill a banner, and it comes out visibly soft or blocky. Take a large image and shrink it down for a thumbnail, and it usually still looks sharp. Same operation — resizing — with two very different outcomes, and the reason comes down to which direction you're actually going.

## What Resizing Does to Pixel Data

Every raster image is a fixed grid of pixels — a 500×500 image has exactly 250,000 of them, no more, no less. Resizing means recalculating that grid at a new size, and the two directions require fundamentally different math:

- **Downscaling (shrinking)** combines multiple original pixels into fewer new ones — there's more source detail than the new grid needs, so the software is *discarding and averaging* real information it already has. This is why shrinking rarely looks bad: you're going from more data to less, and the loss is subtle by nature.
- **Upscaling (enlarging)** has to invent pixels that were never in the original — there's more grid to fill than there is source detail to fill it with, so the software is *guessing* what should go in the gaps, typically by blending nearby pixel values (a process called interpolation). No interpolation algorithm can recover detail that was never captured in the first place, which is exactly why upscaled images look soft, blurry, or blocky depending on how aggressively they were stretched.

## Why This Isn't a Bug in the Tool

A blurry upscale isn't a sign of a bad resizing algorithm — it's a hard limit on the operation itself. Interpolation can smooth the transition between existing pixels, which is why modern resizing looks better than the blocky nearest-neighbor scaling of decades ago, but smoothing a guess is still a guess. Genuinely adding detail that was never captured is a fundamentally different (and far heavier) problem than resizing — that's what dedicated "AI upscaling" tools attempt, at real computational cost, and even those have visible limits.

## The Practical Rule

If you need an image larger than its original resolution, the honest fix is to get a higher-resolution source — a bigger photo, a higher-DPI export, a vector version if one exists — rather than stretching what you have. If you're shrinking an image down, you have real headroom: downscaling to the exact dimensions you need, rather than serving an oversized image and letting a webpage or app resize it on the fly, both looks better and loads faster.

[FileCast's Image Resize tool](/convert/image-resize/) resizes to exact dimensions entirely in your browser — the right tool for downscaling cleanly, or for enlarging by an amount small enough that interpolation still holds up. If the goal is a smaller file rather than different dimensions, [Bulk Image Compress](/convert/bulk-image-compress/) reduces file size across up to 10 images at once without changing their resolution.

## The One-Sentence Version

Shrinking an image discards detail it already has; enlarging one has to invent detail it never had — which is the entire reason upscaling looks worse than downscaling, no matter how good the resizing algorithm is.
