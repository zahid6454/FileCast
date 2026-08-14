## HTML vs. Plain Text

| Feature | HTML | Plain Text |
|---|---|---|
| Formatting | Tags control bold, links, structure | None — just line breaks |
| Scripts and styles | Can be embedded | Not applicable |
| File size | Larger (markup adds bytes) | Smaller |
| Searchable/indexable as raw content | Markup can interfere | Clean, direct |
| Best for | Web pages, rich display | Plain-text fields, search indexing, analysis |

### Keep Content as HTML When

- It needs to render with formatting, links, and images in a browser
- You're editing or storing it in a CMS that expects markup

### Strip to Plain Text When

- You're pasting content into a field that doesn't support (or shouldn't render) markup
- You're feeding it into a text-analysis tool, search index, or word counter
- You want to read the actual copy without HTML cluttering every line
