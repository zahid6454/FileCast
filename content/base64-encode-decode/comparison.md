## Plain Text vs. Base64

| Feature | Plain Text / Binary | Base64 |
|---|---|---|
| Character set | Anything, including raw bytes | 64 fixed ASCII characters + padding |
| Size | Original size | ~33% larger |
| Safe to paste into JSON, XML, URLs | Not always | Yes |
| Human readable | Yes (if text) | No — looks like random characters |
| Common uses | Source data, files | Email attachments, data URLs, API tokens, config files |

### Keep Data as Plain Text/Binary When

- It's already in a format the destination system accepts directly
- File size matters and the ~33% overhead isn't worth it
- The data needs to stay human-readable, like a log file

### Encode to Base64 When

- You need to embed binary data (an image, a font) directly inside CSS, HTML, or JSON
- A system only accepts plain-text fields but you need to send binary data through it
- You're constructing a Basic Auth header or a JWT segment by hand
