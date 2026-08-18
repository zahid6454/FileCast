## AVIF vs WebP — When to Use Each

| Feature | AVIF | WebP |
|---|---|---|
| File size | Generally smaller | Small, but usually larger than AVIF |
| Compression | Lossy or lossless | Lossy or lossless |
| Transparency | Supported | Supported |
| Animation | Supported | Supported |
| Color depth | Up to 12-bit | 8-bit |
| Compatibility | ~93% of browsers, ~1% of websites actually use it | Broader real-world adoption, longer track record |
| Encoder/tooling maturity | Newer, still maturing | Mature, widely integrated into CMS/CDN pipelines |

### Keep AVIF When

- Serving images on your own website to modern browsers
- Maximum compression and HDR/wide-color support matter most
- You control both the encoder and the viewing environment

### Convert to WebP When

- Publishing to a platform, CMS, or CDN that supports WebP but not AVIF
- You want broader real-world compatibility than AVIF currently has
- Your image-optimization pipeline is already built around WebP
