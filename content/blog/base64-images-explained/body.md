## An Image That's Also a String of Letters

Look inside a stylesheet or an HTML file and you'll occasionally find an image that isn't a file path at all — instead there's a `src` or `background` attribute holding a huge block of text starting with something like `data:image/png;base64,iVBORw0KG...`. That's not a placeholder or an error. It's the actual image, fully encoded as text, embedded directly in the code instead of loaded from a separate file.

## Why You'd Turn an Image Into Text

Base64 encoding converts binary data (like an image's raw bytes) into a string made only of letters, numbers, and a few symbols — a format that can be safely embedded anywhere plain text is allowed: inside HTML, CSS, JSON, or a URL. The reason to do this is almost always to avoid a separate network request. Normally, an `<img src="logo.png">` triggers the browser to make a second trip to the server to fetch that file. A Base64-encoded image needs no second request — it's already sitting inside the HTML or CSS that already loaded, so the browser has it immediately.

## What You Give Up: Roughly 33% More Size

Base64 isn't a compression format — it's the opposite. Encoding binary data as text takes roughly 4 bytes to represent every 3 bytes of the original file, which inflates the image by about a third. A 30KB PNG becomes roughly a 40KB string. For a small icon, that's negligible. For anything larger, it adds real weight to whatever file it's embedded in, and unlike a normal image file, an embedded Base64 string can't be cached by the browser separately from the page — every time the HTML or CSS reloads, the "image" reloads with it, even if the picture itself never changed.

## When It's Genuinely the Right Call

- **Small, frequently-reused icons** (a UI sprite, a tiny logo) where saving a network round-trip matters more than the size increase, and the icon is small enough that the 33% overhead is trivial in absolute terms.
- **Emails**, where many email clients block external image loading by default — an embedded image displays regardless, while a linked one might just show a broken icon.
- **Offline or single-file tools**, where the whole point is that everything needed to render the page is self-contained in one file, with no external dependencies to fetch.

## When It's the Wrong Call

For anything larger than a small icon — a hero image, a product photo, a full-size graphic — Base64 embedding usually makes things worse: you inflate the page's size, lose the browser's ability to cache the image independently, and gain nothing, since a normal image request for a large file was never the bottleneck a Base64 embed was solving. That's a case for a real image file with normal caching, not an embedded string.

[FileCast's Image to Base64 tool](/convert/image-to-base64/) converts any image into that data-URL string instantly in your browser — useful for the icon and email cases above. Going the other direction, [Base64 to Image](/convert/base64-to-image/) decodes a data URL back into a real, downloadable image file.

## The One-Sentence Version

Base64-encoding an image trades a network request for roughly 33% more size and no independent caching — a good trade for a small icon or an email, a bad one for anything bigger.
