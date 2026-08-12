## Whitespace Minification vs. Full Compression

Not all "minifiers" do the same amount of work. This tool does the safe half of that job — the half that's impossible to get wrong.

| Technique | What It Does | Risk | This Tool |
|---|---|---|---|
| Strip comments | Removes `//`, `/* */` | None, if string/regex-aware | ✅ Yes |
| Collapse whitespace | Removes extra spaces, line breaks | Low, if string-aware | ✅ Yes |
| Rename variables | Shortens `myLongVariableName` to `a` | Can break code that references names by string (reflection, some frameworks) | ❌ No |
| Dead code elimination | Removes unreachable code | Requires full static analysis to be safe | ❌ No |
| Operator-spacing removal | Removes spaces around `+`, `-` etc. | Can silently change meaning (`a + +b` → `a++b`) | ❌ No |

### When This Level Is Enough

For most CSS and a lot of JavaScript, comments and whitespace account for a meaningful share of file size on their own — often 20-30%. If you need maximum compression (variable renaming, dead code elimination), a build-time tool like Terser or esbuild is the right call; this tool is for a quick, safe pass without setting one up.
