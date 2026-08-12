## Common Scenarios for Formatting JSON

### Debugging an API Response

APIs frequently return minified JSON to save bandwidth. When you're trying to understand a response's structure or find a specific field, formatting it first makes the nesting obvious instead of forcing you to count braces.

### Reviewing a Config File

Generated or exported config files (package-lock.json, a build tool's output, an exported settings file) are often written as one dense line. Formatting them before a code review makes the actual change visible instead of hidden inside a wall of text.

### Documenting a JSON Structure

When writing documentation or a bug report that includes a JSON example, formatted output is far easier for readers to follow than a minified blob. It also makes it obvious at a glance which fields are nested inside which.

### Preparing Data for a Pull Request

If a JSON file gets minified by a build step or an editor auto-save, formatting it back before committing keeps the diff readable — reviewers can see which specific value changed instead of an entire line being flagged as different.

### Cleaning Up Copy-Pasted JSON

JSON copied from a terminal, a browser's network tab, or a chat message often loses its original formatting. Running it through a formatter restores consistent indentation before you paste it somewhere permanent, like your own project's [JSON to YAML](/convert/json-to-yaml/) config.

If you're also cleaning up screenshots or diagrams for the same write-up, our [Image Compressor](/convert/image-compress/) can shrink them without losing quality.
