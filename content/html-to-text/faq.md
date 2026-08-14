## Frequently Asked Questions

### Is my HTML uploaded anywhere?

No. Stripping happens entirely in your browser — nothing is uploaded to any server.

### Does this preserve any formatting at all?

It preserves line breaks — paragraphs, headings, list items, and `<br>`/`<hr>` all become new lines in the output — but no bold, italics, links, or other inline formatting, since plain text has no way to represent those.

### What happens to `<script>` and `<style>` content?

It's removed entirely, tags and content both. Inline JavaScript or CSS is never treated as visible page text, so it won't leak into your output.

### Does this decode HTML entities like `&amp;` or `&nbsp;`?

Yes. Common named entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&nbsp;`, and others) and numeric entities (`&#39;`, `&#x2014;`) are decoded back into their actual characters.

### What happens to links — do I lose the URLs?

Yes, by design. This tool extracts visible text only, so `<a href="...">click here</a>` becomes just "click here" — the URL itself is discarded. If you need the links preserved, this isn't the right tool for that.
