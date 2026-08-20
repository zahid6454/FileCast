## What Is EXIF/Metadata Removal?

Most photos carry hidden data alongside the visible image — EXIF metadata. This can include the camera or phone model, the exact date and time the photo was taken, camera settings, and, if location services were on, the precise GPS coordinates of where it was shot. PNG and WebP files can carry similar hidden text fields. None of this is visible when you look at the photo, but it travels with the file wherever it's shared.

Removing this metadata strips all of that hidden information while leaving the visible image completely unchanged — same pixels, same quality, same dimensions.

### Why Remove Metadata?

Sharing a photo with its metadata intact can unintentionally reveal your location, the device you used, or the exact time you were somewhere. This matters most for photos posted publicly — on social media, marketplaces, or forums — where anyone who downloads the original file can extract that data with free, widely available tools.

### Supported Formats

This tool accepts JPG, PNG, and WebP images. It removes EXIF, IPTC, and XMP metadata (camera info, GPS location, timestamps, author fields, and similar hidden text data) while keeping the color profile intact.

### How This Tool Works

This tool works directly on the file's bytes rather than re-encoding the image through a canvas. It locates and removes only the metadata segments in the file — the compressed image data itself is copied through untouched, so there's no quality loss and no recompression, unlike tools that strip metadata as a side effect of resaving the image. Everything happens locally in your browser; your photo is never uploaded to any server.
