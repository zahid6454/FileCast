## Frequently Asked Questions

### Is it safe to generate QR codes here?

Yes. This tool runs entirely in your browser. The text you enter is processed on your own device — nothing is uploaded to a server, and nothing about what you encode is logged or tracked.

### How much text can I encode?

Up to roughly 2,300 bytes (a bit less for text with a lot of multi-byte characters, like emoji or non-Latin scripts, since each of those takes more than one byte). That's enough for a long URL, a full Wi-Fi credential string, or several paragraphs of plain text.

### What happens if part of the QR code is damaged or covered?

This tool uses error correction level M, which can recover the encoded data even if roughly 15% of the code is damaged, smudged, or covered — enough headroom for a small logo placed in the center, within reason.

### What file format does the QR code download as?

An SVG (scalable vector graphic). Unlike a PNG or JPG, an SVG QR code can be resized to any dimension — for a small sticker or a large sign — without losing sharpness or becoming pixelated.

### Can I encode a Wi-Fi network or contact card, not just a URL?

Yes — this tool encodes whatever text you give it. For a Wi-Fi network, use the format `WIFI:S:NetworkName;T:WPA;P:Password;;`; for a contact card, use the vCard format. Most QR scanner apps recognize these formats automatically and offer to join the network or save the contact.
