## Common JSON Syntax Mistakes

Most invalid JSON comes down to a handful of recurring mistakes, usually introduced by hand-editing:

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Mistake</th><th>Example (invalid)</th><th>Fix</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg>Trailing comma</span></td><td data-label="Example (invalid)"><code>{"a": 1,}</code></td><td data-label="Fix">Remove the comma before <code>}</code> or <code>]</code></td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Single-quoted strings</span></td><td data-label="Example (invalid)"><code>{'a': 1}</code></td><td data-label="Fix">JSON requires double quotes: <code>{"a": 1}</code></td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Unquoted keys</span></td><td data-label="Example (invalid)"><code>{a: 1}</code></td><td data-label="Fix">Quote every key: <code>{"a": 1}</code></td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-x"></use></svg>Comments</span></td><td data-label="Example (invalid)"><code>{"a": 1} // note</code></td><td data-label="Fix">JSON has no comment syntax — remove it</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Missing comma</span></td><td data-label="Example (invalid)"><code>{"a": 1 "b": 2}</code></td><td data-label="Fix">Add a comma between properties</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Unescaped control characters</span></td><td data-label="Example (invalid)">A raw newline inside a string</td><td data-label="Fix">Escape it as <code>\n</code>, or remove it</td></tr>
</tbody>
</table>
</div>

### When Formatting Alone Isn't Enough

A formatter will happily choke on any of the mistakes above with a generic parse error. A validator's job is specifically to catch these and tell you where — so you're not scanning a wall of text looking for one missing comma.
