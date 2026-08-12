## Frequently Asked Questions

### Is it safe to minify my data here?

Yes. This tool processes your data entirely in your browser. Nothing is uploaded to any server — minification happens locally on your device. No one else can see or access your data during or after minification.

### Does minifying change my data?

No. Minifying only removes whitespace. Every key, value, and structure stays exactly the same — parsing the minified output produces an object identical to your original input.

### Does this rename keys or shorten values to save more space?

No. That would change the data itself, not just its formatting, and would break anything expecting the original key names. This tool only strips whitespace, which is always safe to remove from JSON.

### What happens if my JSON is invalid?

The tool tells you so, with the specific parsing error, instead of producing broken or partial output. Fix the issue in your input and try again.

### Can I minify multiple files at once?

This tool minifies one input at a time. Paste your JSON, minify it, and copy or download the result. For additional files, clear the input and repeat the process.
