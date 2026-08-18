## AVIF vs JPG — When to Use Each

| Feature | AVIF | JPG |
|---|---|---|
| File size | Smaller (roughly 50% of JPEG at similar quality) | Larger |
| Image quality | Excellent, especially at low bitrates | Good, but blocky artifacts at high compression |
| Transparency | Supported | Not supported |
| HDR / wide color | Supported | Not supported |
| Color depth | Up to 12-bit | 8-bit |
| Compatibility | ~93% of browsers, ~1% of websites actually use it | Universal — every device, browser, and editor |
| Editing software | Limited support, growing | Universal |
| Printing services | Rarely accepted | Accepted everywhere |

### Keep AVIF When

- Serving images on your own website to modern browsers
- You control both the encoder and the viewing environment
- File size and load time matter more than maximum compatibility
- You need HDR or wide-color-gamut image data preserved

### Convert to JPG When

- Uploading to a photo editor, CMS, or platform that doesn't accept AVIF
- Sending images to a printing service
- Sharing with someone whose device or software may not open AVIF
- Archiving photos somewhere long-term compatibility matters more than file size
