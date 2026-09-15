## Why a Ten-Page PDF Can Be 40MB

A PDF full of dense paragraphs and no pictures is almost always small — text is cheap to store. The PDFs that blow past an email attachment limit or an upload cap are nearly always the ones built from scanned pages or full-resolution photos, because a single uncompressed image can outweigh a hundred pages of plain text by itself. If your PDF is unexpectedly huge, the size is sitting in its images, not its words.

That matters because it tells you exactly what compression has to do: it doesn't need to touch the text at all. It needs to shrink the images.

## What "Compressing a PDF" Actually Does

A PDF compressor works on two layers, and only one of them has any visual cost:

- **Lossless structural cleanup** — removing duplicate embedded fonts, stripping unused objects, and re-encoding the internal file structure more efficiently. This recovers some size for free, with zero quality impact, but usually not much on an image-heavy file.
- **Image re-encoding** — the layer that does the real work. Photos and scans embedded in the PDF get recompressed, typically by lowering their resolution (DPI) and/or their JPEG compression quality. This is where the size savings actually come from, and it's also the only step that can visibly degrade the file if pushed too far.

A page of a scanned document rarely needs to be stored at 600 DPI to remain perfectly legible on screen or printed at normal size — most scanners default to a resolution far higher than any practical use requires, so there's real slack to reclaim before quality loss becomes visible at all.

## Why "Without Losing Quality" Isn't a Contradiction

Compression only becomes visible when it's pushed past the point where an image genuinely needs that much detail. A photo destined for a printed poster and a photo destined for an email attachment don't need the same resolution — and a tool that lets you pick a compression level (light, medium, aggressive) is really letting you pick which of those two situations you're actually in.

- **Light compression** targets the resolution and file structure alone — it recovers a meaningful chunk of size with no perceptible change, because most source images carry far more detail than a screen or a normal print run can use.
- **Aggressive compression** starts trading visible sharpness for size, which is the right call when a document just needs to clear an upload limit and nobody is going to zoom in on it.

The mistake is treating compression as one setting instead of a dial — running every file through maximum compression regardless of what it's for is how "compress a PDF" gets a reputation for making things blurry.

## When You Shouldn't Compress at All

If a PDF is already small — a few pages of text with no images — running it through a compressor won't do much, because there's no image weight to recover in the first place. And if a document needs to preserve exact image fidelity (a technical drawing, a document that will itself be printed and scanned again), be conservative with the compression level rather than defaulting to maximum; the same dial that saves the most space is the one most likely to matter there.

For the common case — a scanned form, a PDF full of photos, a report exported at unnecessarily high resolution — that's exactly what [FileCast's PDF Compress tool](/convert/pdf-compress/) is for: pick a compression level and get a file that clears the size limit without the pixelation that comes from just cranking every setting to maximum.

## The One-Sentence Version

A bloated PDF is almost always bloated because of its images, not its text — so compression works by right-sizing those images to what the document is actually for, and "quality loss" only shows up when that dial gets pushed further than the document needed.
