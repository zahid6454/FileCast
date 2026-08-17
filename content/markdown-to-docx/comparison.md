## Markdown vs DOCX — When to Convert

Markdown and DOCX serve different purposes. A `.md` file is a lightweight, editable source format, while a `.docx` file is a fully-featured, editable Word document. Here is how they compare.

| Feature | Markdown (.md) | DOCX Document |
|---|---|---|
| Editing | Trivial in any text editor | Full word-processor editing (Word, LibreOffice, Google Docs) |
| Formatting marks | Visible as raw punctuation | Rendered as real headings, bold, lists |
| Collaboration | Diffs cleanly in Git | Track changes, comments, shared review |
| Version control | Plain text, diffs cleanly | Binary-ish format, doesn't diff meaningfully |
| Audience | Developers and Markdown-aware tools | Anyone with a word processor |

### Keep as Markdown When

- You or a collaborator still needs to edit the raw source
- The file lives in a Git repository (a README, docs, release notes)
- It will be rendered by a platform that understands Markdown natively (GitHub, a wiki, a static site)
- You want the smallest, most portable, plain-text source format

### Convert to DOCX When

- A collaborator needs to edit the content in Word, without knowing Markdown syntax
- You need track changes, comments, or a shared review workflow
- A form or submission process specifically requires a `.docx` file
- You want the formatting to render correctly in a familiar word processor
