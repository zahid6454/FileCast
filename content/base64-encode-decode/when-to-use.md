## Common Scenarios for Base64 Encoding/Decoding

### Embedding Small Images in CSS or HTML

Instead of a separate HTTP request for a tiny icon, developers often embed it directly as a Base64 `data:` URL inside CSS or an `<img src>`. This tool encodes the raw data; if the image itself is still large before encoding, run it through our [Image Compressor](/convert/image-compress/) first so the resulting Base64 string doesn't bloat your stylesheet.

### Reading a JWT or API Token by Hand

Many tokens and auth headers carry Base64-encoded segments. Pasting one in here decodes it back to readable text so you can inspect what's actually inside, without writing a script.

### Debugging a Base64 API Payload

APIs sometimes return binary data (like a file or an image) as a Base64 string inside a JSON response. Decoding it here lets you quickly check whether the payload looks right before wiring up real code to handle it.

### Constructing a Basic Auth Header

HTTP Basic Authentication sends credentials as `username:password`, Base64-encoded. Typing that pair in here gives you the exact header value to paste into a request or config file.

### Sending Binary Data Through a Text-Only Field

Some config files, environment variables, or legacy systems only accept plain text. Encoding binary data to Base64 first lets it travel safely through fields that would otherwise mangle raw bytes.
