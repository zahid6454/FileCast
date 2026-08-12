## Frequently Asked Questions

### Is it safe to minify my code here?

Yes. This tool processes your code entirely in your browser. Nothing is uploaded to any server — minification happens locally on your device. No one else can see or access your code during or after minification.

### How does it know whether I pasted CSS or JavaScript?

It looks for CSS-shaped patterns (selector blocks like `.button { color: blue; }`, at-rules like `@media`) versus JavaScript keywords and syntax (`function`, `const`, `=>`). For a typical file of either language this is reliable; if your snippet is very short or unusual, double-check the downloaded filename (`styles.min.css` vs `script.min.js`) matches what you expected.

### Will this break my regular expressions or template literals?

No. The minifier tracks string, template literal (`` ` ``), and regular-expression boundaries as it scans, so a `//` inside a regex like `/^https?:\/\//` or a comment-looking sequence inside a string is left untouched rather than mistaken for a comment.

### Does this rename my variables to shorten them further?

No. This tool only removes comments and non-significant whitespace — it never renames identifiers, removes dead code, or changes spacing around operators, all of which carry real risk of subtly changing behavior if done with a simple regex-based tool instead of a full parser. For that level of compression, use a build-time tool like Terser or esbuild.

### Can I minify multiple files at once?

This tool minifies one input at a time. Paste your CSS or JS, minify it, and copy or download the result. For additional files, clear the input and repeat the process.
