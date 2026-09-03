## Common XML Well-Formedness Mistakes

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Mistake</th><th>Example (invalid)</th><th>Fix</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-x"></use></svg>Unclosed tag</span></td><td data-label="Example (invalid)"><code>&lt;name&gt;Alice&lt;/root&gt;</code></td><td data-label="Fix">Every opened tag needs a matching close: <code>&lt;name&gt;Alice&lt;/name&gt;</code></td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Mismatched tags</span></td><td data-label="Example (invalid)"><code>&lt;a&gt;&lt;b&gt;&lt;/a&gt;&lt;/b&gt;</code></td><td data-label="Fix">Tags must close in the reverse order they opened</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Multiple root elements</span></td><td data-label="Example (invalid)"><code>&lt;a&gt;1&lt;/a&gt;&lt;b&gt;2&lt;/b&gt;</code></td><td data-label="Fix">Wrap them in a single root: <code>&lt;root&gt;&lt;a&gt;1&lt;/a&gt;&lt;b&gt;2&lt;/b&gt;&lt;/root&gt;</code></td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Unescaped special characters</span></td><td data-label="Example (invalid)"><code>&lt;note&gt;Tom &amp; Jerry&lt;/note&gt;</code></td><td data-label="Fix">Escape <code>&amp;</code> as <code>&amp;amp;</code> (also <code>&lt;</code> as <code>&amp;lt;</code>)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Unquoted attribute values</span></td><td data-label="Example (invalid)"><code>&lt;item id=42&gt;</code></td><td data-label="Fix">Attribute values need quotes: <code>&lt;item id="42"&gt;</code></td></tr>
</tbody>
</table>
</div>

### Well-Formed vs. Schema-Valid

Well-formed means the XML syntax itself is correct — matched tags, one root, proper escaping. It doesn't mean the document matches a particular structure a system expects (that's what an XSD or DTD schema checks separately). This tool checks well-formedness, which is the first thing that has to be true before schema validation is even possible.
