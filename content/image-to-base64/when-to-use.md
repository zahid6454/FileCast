## Common Scenarios for Image to Base64

### Embedding Icons in CSS

Small, frequently-reused icons — like a logo or a UI sprite — are often embedded directly in a CSS `background-image` as a data URL. This saves a separate HTTP request for every icon, which adds up on pages with dozens of small graphics.

### Sending Images Through a JSON API

Some APIs accept or return images as part of a JSON payload rather than as a separate file upload. Converting the image to a Base64 string first lets it travel as plain text inside the same request. If you're also working with the JSON on the other end, FileCast's [JSON Formatter](/convert/json-formatter/) can help you validate and clean up the payload once the image is embedded.

### Building a Self-Contained HTML File

A single HTML file with no external images, stylesheets, or scripts is easier to email, archive, or hand off — every image just needs to be a data URL inside an `<img src="...">` tag instead of a linked file.

### Storing an Image in a Config or Data File

Some configuration formats and databases don't have a clean way to reference an external image file. Encoding the image as Base64 text lets it live directly inside the same file or record as everything else.

### Testing or Debugging Without Hosting a File

When you just need to quickly preview how an image renders inline — in an email client, a chat app, or a browser — pasting a data URL is often faster than uploading the file somewhere first.
