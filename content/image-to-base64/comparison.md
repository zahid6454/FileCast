## Base64 vs a Regular Image File — When to Embed

A Base64 data URL and a regular image file show the exact same picture — the difference is how it's stored and delivered, not how it looks. Here's how the two compare.

| Feature | Image File | Base64 Data URL |
|---|---|---|
| File size | Original size | About 33% larger (Base64 encoding overhead) |
| HTTP requests | One extra request per image | Zero — embedded directly in the page or file |
| Caching | Cached separately by the browser | Cached only as part of the parent file |
| Editability | Open directly in any image viewer | Must be decoded back to an image first |
| Best for | Most images, especially large or reused ones | Small icons, inline emails, single-file bundles |

### Keep a Regular Image File When

- The image is large — the ~33% size increase adds up quickly
- The same image is reused across many pages (a separate file can be cached once)
- You need to edit the image again later in an image editor
- You're optimizing for page load performance at scale

### Convert to Base64 When

- You're embedding a small icon or logo directly into CSS or HTML
- You need to send an image inside a JSON payload or config file
- You're building a single-file HTML email or report with no external assets
- You want to avoid an extra network request for a tiny, one-off image
