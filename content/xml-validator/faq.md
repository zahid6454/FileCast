## Frequently Asked Questions

### Is it safe to validate my data here?

Yes. This tool processes your data entirely in your browser. Nothing is uploaded to any server — validation happens locally on your device. No one else can see or access your data during or after validation.

### What exactly does "well-formed" mean?

It means your XML follows the basic structural rules: every tag closes, tags nest properly without overlapping, there's exactly one root element, and special characters are escaped. It doesn't check the document against a specific schema (XSD/DTD) — see the next question.

### Does this validate against an XSD or DTD schema?

No. Schema validation checks that your XML matches a specific structure (which elements are allowed where, what data types are expected) defined in a separate XSD or DTD file. This tool checks well-formedness only — the baseline syntax check that has to pass before schema validation is even possible.

### What does the error message tell me?

It describes the specific well-formedness problem the parser hit, such as a mismatched or unclosed tag. For very short inputs the description can be terse, but it always points at the actual structural issue rather than a generic "parse failed."

### Can I validate multiple files at once?

This tool validates one input at a time. Paste your XML, check the result, and repeat for additional files.
