## Something the Format Already Supports

Adobe's PDF specification has had password protection built in since the format's earliest versions — it's not a feature that requires premium software, a subscription, or a "Pro" upgrade. Every PDF reader on every platform already knows how to prompt for a password and decrypt a protected file, because that behavior is part of the spec itself, not an add-on any single company controls.

## Two Different Passwords, Two Different Jobs

PDF protection actually covers two distinct things, and it's worth knowing which one you're setting:

- **An open password (user password)** locks the document itself — nobody can view the content at all without entering it first. This is what most people mean by "password-protect a PDF."
- **A permissions password (owner password)** leaves the document readable to anyone, but restricts specific actions — printing, copying text, editing — unless that password is entered. This is the mechanism behind PDFs that let you read but not copy-paste the text.

A tool that only offers one of these isn't broken; it's just covering the more common case. Most everyday needs — sending a sensitive document only the recipient should be able to open — call for the open password, not the permissions one.

## What the Password Actually Encrypts

A real PDF password isn't just a lock screen bolted on top of an otherwise-open file — the document's content is genuinely encrypted using the PDF spec's own Standard Security Handler, meaning the underlying data is unreadable without the correct password, not just hidden behind a prompt a determined person could bypass. That's a meaningfully stronger guarantee than, say, a "protected" spreadsheet where the data is sitting in plain sight and the password is more of a formality. Encryption strength varies by tool and by how the PDF was produced — the spec has supported everything from the original 40-bit handler up through modern AES-256 over the years — so this is genuine encryption, not a cosmetic lock, but it's worth keeping in mind that "password-protected" isn't a single fixed strength across every PDF you'll encounter.

## Why This Doesn't Need to Cost Anything

Because password protection lives in the PDF specification itself rather than being a proprietary feature, any tool that correctly implements the spec can add it — there's no licensing fee or special access required to write software that encrypts a PDF with a password. Paywalls around this specific feature are a business decision, not a technical necessity. [FileCast's PDF Protect tool](/convert/pdf-protect/) adds a password to a PDF entirely in your browser, for free, with nothing uploaded — the encryption happens locally before the file ever leaves your device. If you're on the other side of this — you have a password-protected PDF and the legitimate right to remove it — [PDF Unlock](/convert/pdf-unlock/) does the reverse.

## The One-Sentence Version

PDF password protection is a built-in part of the file format, not a premium feature — which is exactly why it doesn't need to cost anything or require an account to use.
