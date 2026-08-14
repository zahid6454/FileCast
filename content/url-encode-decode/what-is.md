## What Is URL Encoding?

URL (or "percent") encoding replaces characters that aren't safe inside a URL — spaces, `&`, `?`, `#`, non-ASCII letters, and more — with a `%` followed by their hex byte value. `hello world` becomes `hello%20world`; `café` becomes `caf%C3%A9`. It keeps a URL parseable when the data inside it (a search query, a redirect target, a file name) contains characters that would otherwise be mistaken for part of the URL's own structure.

Decoding reverses the process, turning `%20` back into a space and so on.

### Why Encode URLs?

Reserved characters like `&` and `=` already mean something specific in a URL (separating query parameters, for example). If a value you're putting into a query string contains one of those characters unencoded, it can silently break the URL or get parsed as a different parameter than you intended. Encoding removes the ambiguity.

### How This Tool Works

Paste text or a percent-encoded string into the box below and click the button. This tool automatically detects which direction you need — if your input contains `%XX` sequences that decode successfully, it decodes them; otherwise, it encodes your input. Everything runs in your browser; nothing is uploaded to any server.
