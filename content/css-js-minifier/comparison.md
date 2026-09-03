## Whitespace Minification vs. Full Compression

Not all "minifiers" do the same amount of work. This tool does the safe half of that job — the half that's impossible to get wrong.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col><col></colgroup>
<thead><tr><th>Technique</th><th>What It Does</th><th>Risk</th><th>This Tool</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Strip comments</span></td><td data-label="What It Does">Removes <code>//</code>, <code>/* */</code></td><td data-label="Risk">None, if string/regex-aware</td><td data-label="This Tool">✅ Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg>Collapse whitespace</span></td><td data-label="What It Does">Removes extra spaces, line breaks</td><td data-label="Risk">Low, if string-aware</td><td data-label="This Tool">✅ Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Rename variables</span></td><td data-label="What It Does">Shortens <code>myLongVariableName</code> to <code>a</code></td><td data-label="Risk">Can break code that references names by string (reflection, some frameworks)</td><td data-label="This Tool">❌ No</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-x"></use></svg>Dead code elimination</span></td><td data-label="What It Does">Removes unreachable code</td><td data-label="Risk">Requires full static analysis to be safe</td><td data-label="This Tool">❌ No</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Operator-spacing removal</span></td><td data-label="What It Does">Removes spaces around <code>+</code>, <code>-</code> etc.</td><td data-label="Risk">Can silently change meaning (<code>a + +b</code> → <code>a++b</code>)</td><td data-label="This Tool">❌ No</td></tr>
</tbody>
</table>
</div>

### When This Level Is Enough

For most CSS and a lot of JavaScript, comments and whitespace account for a meaningful share of file size on their own — often 20-30%. If you need maximum compression (variable renaming, dead code elimination), a build-time tool like Terser or esbuild is the right call; this tool is for a quick, safe pass without setting one up.
