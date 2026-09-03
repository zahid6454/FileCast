## Common YAML Mistakes

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Mistake</th><th>Why It Breaks</th><th>What This Tool Reports</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Tab used for indentation</span></td><td data-label="Why It Breaks">YAML's spec forbids tabs for indentation — most parsers reject it outright</td><td data-label="What This Tool Reports">The exact line the tab appears on</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Inconsistent sibling indentation</span></td><td data-label="Why It Breaks">Two items at the same level must share the exact same indent</td><td data-label="What This Tool Reports">The line whose indent doesn't match its siblings</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg>Duplicate key in the same mapping</span></td><td data-label="Why It Breaks">The second value silently overwrites the first, hiding data</td><td data-label="What This Tool Reports">The key name and the line of the duplicate</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Malformed flow collection</span></td><td data-label="Why It Breaks">An unclosed <code>[</code> or <code>{</code> on an inline list/map</td><td data-label="What This Tool Reports">The line the collection starts on</td></tr>
</tbody>
</table>
</div>

### Why These Three Checks Specifically

Unlike JSON, YAML's structure is invisible — there's no closing brace to mismatch, no comma to forget. Its mistakes are almost always about whitespace and repetition instead, which is exactly what these checks target. A duplicate key in particular is dangerous precisely because it doesn't look wrong; a tool has to check for it explicitly.
