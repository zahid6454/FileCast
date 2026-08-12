## Common Scenarios for Formatting HTML

### Debugging Minified Production Markup

When a live page's HTML is minified, "View Source" returns one dense line. Formatting it first makes it possible to actually locate the element you're trying to debug instead of scrolling sideways forever.

### Reviewing a Template Change

Server-rendered templates (Jinja2, Handlebars, ERB output) can end up minified by a build step. Formatting the rendered output before a code review makes the actual structural change visible instead of buried in a single line.

### Documenting a Markup Snippet

When writing documentation or a component library entry that includes an HTML example, formatted output is far easier for readers to copy, understand, and adapt than a minified blob.

### Cleaning Up Copied Markup

HTML copied from a browser's dev tools, an email client, or a CMS's rich text editor often loses consistent indentation. Running it through a formatter restores a readable structure before you paste it into your own codebase.

### Preparing a Bug Report

When reporting a rendering bug, including formatted HTML makes it far easier for someone else to spot the structural issue at a glance. If the same page also needs a printable copy, our [HTML to PDF converter](/convert/html-to-pdf/) turns any page into a PDF directly.
