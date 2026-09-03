## What Is JSON-to-TypeScript Conversion?

TypeScript describes the shape of your data with interfaces — named definitions listing each field and its type. When you're working with a JSON API response, a config file, or a data sample, writing that interface by hand means manually reading through the JSON and typing out every field, one at a time.

This tool automates that: it looks at a real JSON sample, infers a type for every value (string, number, boolean, nested object, array), and generates the matching TypeScript `interface` definitions for you.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
    <span class="stat-tile__label">Nested objects named</span>
    <span class="stat-tile__sub">Each one split into its own interface</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
    <span class="stat-tile__label">Types inferred automatically</span>
    <span class="stat-tile__sub">string, number, boolean, arrays</span>
  </div>
</div>

### Why Generate Types From JSON?

Typing an interface by hand is slow and error-prone, especially for a deeply nested API response with dozens of fields. Generating it from a real example is faster and guarantees the field names and basic types actually match your data — no `any` scattered through your code because typing it all out felt like too much effort.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>Paste a JSON sample into the box below and click Generate Interface. This tool walks the structure, creates a named interface for every nested object, and infers array element types from the first item. Everything runs <strong>in your browser</strong>; nothing is uploaded to any server.</p>
</div>
