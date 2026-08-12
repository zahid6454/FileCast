## Structural Diff vs. Text Diff

| Feature | Text Diff | JSON Diff (this tool) |
|---|---|---|
| Compares | Lines of text | Data — keys, values, array positions |
| Key order | Any reordering shows as changed | Ignored — `{"a":1,"b":2}` equals `{"b":2,"a":1}` |
| Whitespace/indentation | Any formatting change shows as changed | Ignored entirely |
| Output | Line-by-line additions/removals | Field-by-field additions/removals/changes, with the exact path |
| Best for | Source code, plain text | JSON data, API responses, config snapshots |

### Reading the Output

Each line in the report starts with a symbol showing what kind of change it is:

- `+ path: value (added)` — the field exists only in the right-hand JSON
- `- path: value (removed)` — the field exists only in the left-hand JSON
- `~ path: old → new` — the value at that path changed

Paths use `$` for the root, `.key` for object fields, and `[index]` for array positions — for example, `$.user.tags[2]`.

### A Note on Arrays

Arrays are compared position by position (index 0 against index 0, and so on), not by matching similar items across different positions. Inserting an item at the start of an array will show every following item as "changed" at its new index, rather than being recognized as a pure insertion — a limitation shared with most simple diff tools, and worth keeping in mind when comparing reordered lists.
