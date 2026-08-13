## Common Scenarios for URL Encoding/Decoding

### Building a Redirect or Share Link by Hand

Query parameters like `?redirect=https://example.com/page?id=5` need the inner URL encoded first, or the second `?` and `=` will be parsed as part of the outer URL instead of as data. This is common when linking to a file someone just processed — for example, a shareable link to a PDF produced with our [PDF Merge](/convert/pdf-merge/) tool.

### Debugging a Broken Link

If a URL with spaces, accented characters, or symbols isn't working, decoding it here shows you exactly what the server is actually receiving — often revealing a missing or double-encoded character.

### Reading a Server Log or Analytics Report

Web server logs and analytics tools often show request paths and query strings in their raw, encoded form. Decoding a logged URL here turns `%3D` and `%26` back into `=` and `&` so you can read it normally.

### Passing Data Through a Query String

APIs and web forms that accept parameters via the URL (rather than a request body) need any value that might contain reserved characters — a search term, an email address, a file path — encoded first so it survives the trip intact.

### Constructing an API Request URL

When building a request URL manually (in a script, a `curl` command, or Postman), encoding path segments and query values ahead of time avoids malformed-request errors caused by unescaped special characters.
