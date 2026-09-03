## Common Scenarios for Converting Base64 to an Image

<div class="scenario-list" markdown="1">
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-upload-cloud"></use></svg></div>
<div class="scenario__body" markdown="1">

### Debugging an API Response

Some APIs return generated images — a chart, a QR code, a rendered thumbnail — as a Base64 string inside a JSON payload instead of a binary attachment. Pasting that string here lets you see exactly what was generated without writing a script to save it to disk first.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></div>
<div class="scenario__body" markdown="1">

### Extracting an Embedded Image from HTML or CSS

Old exports, scraped pages, or inline `<img src="data:image/...">` tags sometimes leave you with only the Base64 string and no separate image file. This tool recovers the original file so you can use it elsewhere — like running it through our [Image Compressor](/convert/image-compress/) before re-embedding a smaller version.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-mail"></use></svg></div>
<div class="scenario__body" markdown="1">

### Reviewing an Email Attachment Encoded as Base64

Some email systems and webhooks deliver image attachments as raw Base64 text. Decoding it here confirms what the attachment actually contains before you trust or forward it.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg></div>
<div class="scenario__body" markdown="1">

### Checking What a Base64 String Actually Decodes To

If you're not sure whether a long Base64 string is even an image (versus some other kind of file), this tool will tell you plainly — it only succeeds when the decoded bytes match a real image file signature, and explains when they don't.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg></div>
<div class="scenario__body" markdown="1">

### Recovering a Screenshot or Icon from a Config File

Some app configs or design tool exports store small icons or previews as inline Base64. Decoding one back to a file lets you open, resize, or reuse it independently of the config it came from.

</div>
</div>
</div>
