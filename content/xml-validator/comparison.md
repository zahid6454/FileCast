## Common XML Well-Formedness Mistakes

| Mistake | Example (invalid) | Fix |
|---|---|---|
| Unclosed tag | `<name>Alice</root>` | Every opened tag needs a matching close: `<name>Alice</name>` |
| Mismatched tags | `<a><b></a></b>` | Tags must close in the reverse order they opened |
| Multiple root elements | `<a>1</a><b>2</b>` | Wrap them in a single root: `<root><a>1</a><b>2</b></root>` |
| Unescaped special characters | `<note>Tom & Jerry</note>` | Escape `&` as `&amp;` (also `<` as `&lt;`) |
| Unquoted attribute values | `<item id=42>` | Attribute values need quotes: `<item id="42">` |

### Well-Formed vs. Schema-Valid

Well-formed means the XML syntax itself is correct — matched tags, one root, proper escaping. It doesn't mean the document matches a particular structure a system expects (that's what an XSD or DTD schema checks separately). This tool checks well-formedness, which is the first thing that has to be true before schema validation is even possible.
