## Frequently Asked Questions

### Is it safe to convert my images here?

Yes. This tool processes your image entirely in your browser. Your file is never uploaded to any server — everything happens locally on your device.

### What does the output file actually contain?

A plain text file with a full data URL, in the form `data:image/png;base64,...`. You can paste this directly into an `<img src="...">` tag, a CSS `background-image` property, or anywhere else a data URL or Base64 string is expected.

### Why is the output larger than my original image?

Base64 encoding represents binary data using only text characters, which adds roughly 33% to the size compared to the original file. This is normal and expected — it's the trade-off for being able to embed the image as plain text.

### Can I convert the Base64 string back into an image?

Yes. FileCast's [Base64 to Image Converter](/convert/base64-to-image/) does the reverse — paste the string back in and download the decoded image file, with a live preview.

### Which image formats are supported?

This tool accepts JPG, PNG, WebP, GIF, BMP, and SVG files. The output data URL's MIME type automatically matches the format of the image you uploaded.
