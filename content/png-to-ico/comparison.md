## PNG vs ICO — When to Use Each

| Feature | PNG | ICO |
|---|---|---|
| Multiple sizes in one file | No — one image per file | Yes — several sizes bundled together |
| Favicon support | Requires a `<link rel="icon">` pointing to a PNG | Native, universally recognized favicon format |
| Editing | Easy to edit in any image editor | Not directly editable — regenerate from a source image instead |
| General image use | Universal — photos, graphics, web images | Narrow — favicons and Windows icons only |
| File size | Smaller, single image | Larger — bundles multiple image sizes |

### Keep PNG When

- You're editing or designing the logo itself
- You need a single image for general use, not a favicon
- You're using the image somewhere other than a browser tab or Windows icon

### Convert to ICO When

- You're setting up a favicon for a website
- You want one file that works crisply at every size a browser might display it
- You're building a desktop application icon for Windows
- A CMS or site builder specifically asks for a `.ico` file
