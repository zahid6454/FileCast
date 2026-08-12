## What Is a JSON Diff?

A plain text diff compares two files line by line — which means reformatting a JSON file (reordering keys, changing indentation) shows up as a wall of changes even when the actual data is identical. A structural JSON diff instead compares the two documents as data: it walks matching keys and array positions and reports only what's actually different, regardless of key order or whitespace.

### Why Diff JSON Structurally?

When comparing two API responses, two config versions, or a before/after snapshot of some data, what you actually want to know is which fields changed — not which lines moved. A structural diff answers that directly: added fields, removed fields, and changed values, each with the exact path to where it happened.

### How This Tool Works

This diff tool runs entirely in your browser. Paste the original JSON on the left and the changed version on the right, click Compare, and get a report of every difference — or a confirmation that both are structurally identical. Your data is never uploaded to any server — the comparison happens locally on your device.
