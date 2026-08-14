## What Is Base64 Encoding?

Base64 is a way of representing binary data — or any text — using only 64 printable ASCII characters (A–Z, a–z, 0–9, `+`, `/`, with `=` for padding). It doesn't compress or encrypt anything; it just re-packages bytes into a format that's safe to paste into places that only expect plain text, like an email body, a JSON field, or a CSS `url()`.

Encoding turns readable text (or raw bytes) into that Base64 alphabet. Decoding reverses it, turning the Base64 string back into the original data.

### Why Use Base64?

Some systems — old email protocols, certain APIs, URL query strings, JSON documents — can't safely carry arbitrary binary bytes or every character a string might contain. Base64 sidesteps that by using a fixed, safe character set, at the cost of making the encoded output about 33% larger than the original.

### How This Tool Works

Paste text or a Base64 string into the box below and click the button. This tool automatically detects which direction you need — if what you pasted decodes cleanly as valid Base64, it decodes it; otherwise, it encodes it. Everything happens in your browser; nothing is uploaded to any server.
