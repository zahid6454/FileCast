## Structural Diff vs. Text Diff

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Text Diff</th><th>JSON Diff (this tool)</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg>Compares</span></td><td data-label="Text Diff">Lines of text</td><td data-label="JSON Diff (this tool)">Data — keys, values, array positions</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Key order</span></td><td data-label="Text Diff">Any reordering shows as changed</td><td data-label="JSON Diff (this tool)">Ignored — <code>{"a":1,"b":2}</code> equals <code>{"b":2,"a":1}</code></td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Whitespace/indentation</span></td><td data-label="Text Diff">Any formatting change shows as changed</td><td data-label="JSON Diff (this tool)">Ignored entirely</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Output</span></td><td data-label="Text Diff">Line-by-line additions/removals</td><td data-label="JSON Diff (this tool)">Field-by-field additions/removals/changes, with the exact path</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="Text Diff">Source code, plain text</td><td data-label="JSON Diff (this tool)">JSON data, API responses, config snapshots</td></tr>
</tbody>
</table>
</div>

### Reading the Output

Each line in the report starts with a symbol showing what kind of change it is:

- `+ path: value (added)` — the field exists only in the right-hand JSON
- `- path: value (removed)` — the field exists only in the left-hand JSON
- `~ path: old → new` — the value at that path changed

Paths use `$` for the root, `.key` for object fields, and `[index]` for array positions — for example, `$.user.tags[2]`.

### A Note on Arrays

Arrays are compared position by position (index 0 against index 0, and so on), not by matching similar items across different positions. Inserting an item at the start of an array will show every following item as "changed" at its new index, rather than being recognized as a pure insertion — a limitation shared with most simple diff tools, and worth keeping in mind when comparing reordered lists.
