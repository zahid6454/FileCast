## Frequently Asked Questions

### Is it safe to compare my data here?

Yes. This tool processes both inputs entirely in your browser. Nothing is uploaded to any server — the comparison happens locally on your device. No one else can see or access your data during or after comparison.

### Does key order matter?

No. `{"a":1,"b":2}` and `{"b":2,"a":1}` are reported as identical, since JSON objects are unordered by definition — this tool compares the data, not the text.

### How are arrays compared?

Position by position: index 0 against index 0, index 1 against index 1, and so on. Inserting an item in the middle of an array will show every following item as changed at its new index, rather than being recognized as a pure insertion — see the comparison section above for more on this.

### What happens if one side isn't valid JSON?

The tool tells you which side — left or right — failed to parse, along with the underlying syntax error, instead of a generic failure. Fix that side and try again.

### Can I compare more than two files, or a whole folder?

This tool compares exactly two JSON values at a time. For comparing many files, you'd need to run this (or a similar structural diff) once per pair.
