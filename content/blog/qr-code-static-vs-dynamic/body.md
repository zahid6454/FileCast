## A QR Code That Stopped Working

Every so often you'll scan a printed QR code — on a menu, a flyer, a package — and land on a "this link has expired" or "page not found" error, even though the poster it's printed on looks brand new. That's usually not a broken QR code. It's a *dynamic* QR code whose subscription lapsed, on a menu, flyer, or package nobody thought to reprint.

## What a Static QR Code Actually Is

A static QR code encodes the destination — a URL, a bit of text, a Wi-Fi password — directly into the pattern itself, permanently, at the moment it's generated. Scan it in ten years and it still points to exactly what was encoded, because the destination isn't stored anywhere external to the code; it *is* the code. Nothing can expire, because there's no external system involved to expire.

## What a Dynamic QR Code Actually Is

A dynamic QR code encodes a short redirect URL owned by whatever service generated it — scanning it hits that service's server first, which then looks up and redirects to your real destination. The appeal is that you can change where it points later without reprinting the code, and many services layer in scan analytics (how many scans, from where, on what device) on top of that redirect. The cost is that the code now depends on a third party's server staying online and your account with that service staying active — stop paying, and the redirect stops resolving, even though the physical QR code hasn't changed at all.

## Which One You Actually Need

Most everyday uses genuinely just need static: a Wi-Fi password on a router, a link to a fixed webpage, a URL on a business card, contact details, an app download link that isn't going to move. If the destination is stable, there's nothing dynamic buys you except an ongoing dependency and, usually, a subscription fee.

Dynamic earns its cost in narrower cases: a printed poster or physical sign where the underlying URL genuinely might need to change later without a reprint, or a marketing campaign that specifically needs scan-count analytics per code. If neither applies — and for most personal and small-business uses, neither does — a static code does the same job with no ongoing dependency and nothing that can silently break.

[FileCast's QR Code Generator](/convert/qr-code-generator/) produces static codes — a scalable SVG generated entirely in your browser, encoding your text or URL directly with no service in the middle to expire, track, or eventually paywall. If your data is more structured than a QR code fits (a product SKU, an inventory number), [Barcode Generator](/convert/barcode-generator/) covers that same "generate once, works forever" case in a linear format.

## The One-Sentence Version

A static QR code is a picture of your destination that works forever; a dynamic one is a redirect through someone else's server that keeps working only as long as you keep paying for it — most uses only need the first one.
