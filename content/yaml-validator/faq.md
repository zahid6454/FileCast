## Frequently Asked Questions

### Is it safe to validate my data here?

Yes. This tool processes your data entirely in your browser. Nothing is uploaded to any server — validation happens locally on your device. No one else can see or access your data during or after validation.

### Why does it flag tabs? My editor uses tabs for everything.

YAML's specification forbids tabs for indentation — most YAML parsers (including the ones Kubernetes, Docker Compose, and Ansible use) reject a tab-indented file outright. If your editor defaults to tabs, configure it to use spaces for YAML files specifically to avoid this.

### What counts as "inconsistent indentation"?

Every item at the same level of a YAML structure — sibling keys in a mapping, sibling items in a list — must share the exact same indentation. If one sibling is indented two spaces and the next is indented three, that's not a stylistic choice YAML tolerates; it's treated as a structural error.

### Why is a duplicate key a problem if my file still "works"?

In YAML, a repeated key at the same level doesn't cause a loud failure — most parsers just silently keep the last value and discard the first. That means a duplicate can hide a real mistake (an accidentally-overwritten setting) that only surfaces later as confusing behavior, which is exactly why this tool flags it explicitly instead of a parser silently overwriting it.

### Does this check my YAML against a specific schema?

No. Like our [XML Validator](/convert/xml-validator/), this checks that your YAML is structurally valid — not that it matches a particular application's expected fields or types. That level of validation needs the specific schema (for example, Kubernetes' own manifest validation) to check against.
