## Common JSON Syntax Mistakes

Most invalid JSON comes down to a handful of recurring mistakes, usually introduced by hand-editing:

| Mistake | Example (invalid) | Fix |
|---|---|---|
| Trailing comma | `{"a": 1,}` | Remove the comma before `}` or `]` |
| Single-quoted strings | `{'a': 1}` | JSON requires double quotes: `{"a": 1}` |
| Unquoted keys | `{a: 1}` | Quote every key: `{"a": 1}` |
| Comments | `{"a": 1} // note` | JSON has no comment syntax — remove it |
| Missing comma | `{"a": 1 "b": 2}` | Add a comma between properties |
| Unescaped control characters | A raw newline inside a string | Escape it as `\n`, or remove it |

### When Formatting Alone Isn't Enough

A formatter will happily choke on any of the mistakes above with a generic parse error. A validator's job is specifically to catch these and tell you where — so you're not scanning a wall of text looking for one missing comma.
