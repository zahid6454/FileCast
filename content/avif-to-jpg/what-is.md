## What Is AVIF?

AVIF (AV1 Image File Format) is a modern image format built on the AV1 video codec, developed by the Alliance for Open Media (AOMedia) — the same group behind Netflix, Google, and Amazon's video compression work. It delivers roughly 50% smaller files than JPEG at comparable visual quality, and supports features JPEG never could: transparency, HDR, wide color gamut, and up to 12-bit color depth.

Browser support for AVIF is now strong — over 93% of browsers in use today can display it, and it's built into every major engine (Chrome, Firefox, Edge, Safari 16.4+). WordPress added native AVIF support in version 6.5.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></span>
    <span class="stat-tile__label">~50% smaller</span>
    <span class="stat-tile__sub">Than JPEG at similar quality</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
    <span class="stat-tile__label">93%+ browser support</span>
    <span class="stat-tile__sub">Chrome, Firefox, Edge, Safari</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sun"></use></svg></span>
    <span class="stat-tile__label">HDR + 12-bit color</span>
    <span class="stat-tile__sub">Features JPEG never had</span>
  </div>
</div>

### Why Convert to JPG?

Despite that browser support, AVIF adoption across the wider web is still under 1% of sites. Plenty of software still doesn't handle it: some photo editors, older CMS platforms, certain printing services, and a fair amount of legacy business software either reject AVIF uploads outright or fail to open the file at all.

JPG, on the other hand, works everywhere it has for decades — every device, editor, printer, and platform accepts it without a second thought.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This converter runs <strong>entirely in your browser</strong> using a real libavif decoder compiled to WebAssembly — the same underlying decode technology browsers use natively. Your AVIF file is decoded and re-encoded as a JPG entirely on your device; it's never uploaded to any server. Larger or higher-resolution images take a little longer to process since AVIF decoding is more computationally intensive than older formats.</p>
</div>
