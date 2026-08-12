## What Is XML Validation?

"Well-formed" is XML's baseline requirement: every tag that opens must close, tags can't overlap, there's exactly one root element, and special characters like `&` and `<` must be escaped inside text content. A document can look mostly right and still fail one of these rules — a single unclosed tag makes the whole document unparseable.

Validation checks your XML against these well-formedness rules and tells you exactly what's wrong when it isn't — instead of leaving you to scan the whole document by eye for the one mismatched tag.

### Why Validate XML?

Hand-edited XML (config files, RSS feeds, SOAP request bodies) is where well-formedness breaks most often — an unclosed tag, an unescaped `&` inside a URL, two root elements left over from a copy-paste. Validating before you use it catches these before they cause a confusing downstream parser failure.

### How This Tool Works

This validator runs entirely in your browser. Paste your XML into the text area, click Validate, and see either a confirmed-valid, formatted result, or a clear description of what's wrong. Your data is never uploaded to any server — validation happens locally on your device.
