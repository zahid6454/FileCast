## What Is YAML Validation?

YAML's readability comes at a cost: unlike JSON's braces and brackets, YAML uses indentation alone to express structure. That makes a single stray tab character, a misaligned line, or a copy-pasted key that already exists elsewhere in the same block a real, common way to silently break a file — often without any obvious syntax error to point at.

Validation checks your YAML for exactly these mistakes and tells you where, instead of leaving you to eyeball a wall of indentation.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg></span>
    <span class="stat-tile__label">Names the exact line</span>
    <span class="stat-tile__sub">Not just "invalid YAML"</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
    <span class="stat-tile__label">3 targeted checks</span>
    <span class="stat-tile__sub">Tabs · indentation · duplicate keys</span>
  </div>
</div>

### Why Validate YAML?

YAML is everywhere in DevOps tooling — Docker Compose, Kubernetes manifests, GitHub Actions workflows, Ansible playbooks — and it's almost always hand-edited. A tab character mixed into spaces, or a config value indented one space off from its siblings, is invisible to the eye but breaks the parser. Validating before you deploy catches it immediately.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This validator runs <strong>entirely in your browser</strong>. Paste your YAML into the text area, click Validate, and see either a confirmed-valid, normalized result, or a specific error naming the problem and the line it's on. It checks for tab-indentation, inconsistent sibling indentation, and duplicate keys — the three mistakes that break hand-written YAML most often. Your data is never uploaded to any server — validation happens locally on your device.</p>
</div>
