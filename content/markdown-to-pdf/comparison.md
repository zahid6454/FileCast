## Markdown vs PDF — When to Convert

Markdown and PDF serve different purposes. A `.md` file is a lightweight, editable source format, while a PDF is a fixed, finished document. Here is how they compare.

| Feature | Markdown (.md) | PDF Document |
|---|---|---|
| Editing | Trivial in any text editor | Requires a PDF editor |
| Formatting marks | Visible as raw punctuation | Rendered as real headings, bold, lists |
| Layout | Reflows to fit whatever renders it | Fixed page size and pagination |
| Version control | Diffs cleanly in Git | Doesn't diff meaningfully |
| Audience | Developers and Markdown-aware tools | Anyone with a PDF viewer |

### Keep as Markdown When

- You or a collaborator still needs to edit the content
- The file lives in a Git repository (a README, docs, release notes)
- It will be rendered by a platform that understands Markdown natively (GitHub, a wiki, a static site)
- You want the smallest, most portable, plain-text source format

### Convert to PDF When

- You're sending the document to someone without a Markdown viewer
- A form, portal, or application specifically requires a PDF upload
- You're printing or archiving the content as a finished document
- You want the formatting to render correctly and consistently for everyone
