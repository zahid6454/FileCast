## Common YAML Mistakes

| Mistake | Why It Breaks | What This Tool Reports |
|---|---|---|
| Tab used for indentation | YAML's spec forbids tabs for indentation — most parsers reject it outright | The exact line the tab appears on |
| Inconsistent sibling indentation | Two items at the same level must share the exact same indent | The line whose indent doesn't match its siblings |
| Duplicate key in the same mapping | The second value silently overwrites the first, hiding data | The key name and the line of the duplicate |
| Malformed flow collection | An unclosed `[` or `{` on an inline list/map | The line the collection starts on |

### Why These Three Checks Specifically

Unlike JSON, YAML's structure is invisible — there's no closing brace to mismatch, no comma to forget. Its mistakes are almost always about whitespace and repetition instead, which is exactly what these checks target. A duplicate key in particular is dangerous precisely because it doesn't look wrong; a tool has to check for it explicitly.
