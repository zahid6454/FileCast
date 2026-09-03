## What Are Number Bases?

A number base (or radix) is the count of unique digits a numbering system uses before it carries over to the next place value. Decimal (base 10) is what people use day to day, with digits 0-9. Computers work natively in binary (base 2, digits 0-1), and programmers often use hexadecimal (base 16, digits 0-9 and A-F) or octal (base 8, digits 0-7) as more compact, human-friendlier stand-ins for binary.

The same value can be written in any of these — `255` in decimal is `11111111` in binary, `FF` in hex, and `377` in octal. They're not different numbers, just different notations for the same quantity.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
    <span class="stat-tile__label">All 4 bases at once</span>
    <span class="stat-tile__sub">Binary · Octal · Decimal · Hex</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
    <span class="stat-tile__label">Arbitrary precision</span>
    <span class="stat-tile__sub">Accurate even for very large numbers</span>
  </div>
</div>

### Why Convert Between Bases?

Binary is what hardware actually stores, but it's long and error-prone to read or type by hand. Hex compresses every 4 binary digits into 1 character, which is why color codes, memory addresses, and byte values are almost always written in hex. Octal shows up in older Unix file permissions (`chmod 755`). Converting between them is a routine part of low-level debugging, bit manipulation, and reading hardware or protocol documentation.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>Type one or more numbers, one per line — plain digits for decimal, or a <code>0x</code>/<code>0b</code>/<code>0o</code> prefix for hex/binary/octal. Click Convert and get all four representations for each. Everything runs <strong>in your browser</strong> using arbitrary-precision arithmetic, so even very large numbers convert accurately. Nothing is uploaded to any server.</p>
</div>
