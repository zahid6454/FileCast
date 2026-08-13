## Raw Text vs. URL-Encoded Text

| Feature | Raw Text | URL-Encoded Text |
|---|---|---|
| Spaces | Literal space | `%20` (or `+` in query strings) |
| Reserved characters (`&`, `?`, `#`, `=`) | Literal, can break URL parsing | Escaped as `%XX` |
| Non-ASCII characters (é, 日本語, emoji) | Literal | UTF-8 bytes, each escaped as `%XX` |
| Safe to embed in a query string | Not always | Yes |
| Human readable | Yes | Harder to read at a glance |

### Keep Text Raw When

- It's not going inside a URL at all
- It's already confirmed safe (plain ASCII letters, digits, `-`, `_`, `.`, `~`)

### URL-Encode Text When

- You're building a query string parameter by hand (`?redirect=` + encoded URL)
- Your value might contain `&`, `=`, `#`, spaces, or non-ASCII characters
- You're debugging why a link with special characters isn't working as expected
