## Same Extension, Different Job

A PDF/A file opens in exactly the same viewer as a regular PDF, looks pixel-identical on screen, and even carries the same `.pdf` extension. That similarity is exactly why the difference between the two trips people up: PDF and PDF/A aren't competing formats, and PDF/A isn't a "better" or "newer" version of PDF. They solve two different problems, and only one of your documents probably needs the second one.

A regular PDF is designed to look right *today*, on *your* software. A PDF/A is designed to look right *decades from now*, on software that doesn't exist yet.

## What PDF/A Actually Requires

PDF/A (ISO 19005) is a formally restricted subset of the PDF specification, built for one purpose: guaranteeing a document renders identically no matter what happens to the software ecosystem around it. To qualify, a file has to give up anything that depends on the outside world:

- **All fonts must be embedded.** A regular PDF can reference a font installed on the viewer's system; if that font disappears, the document reflows or substitutes silently. PDF/A requires every font baked directly into the file.
- **No external references.** Linked files, external fonts, and anything the PDF depends on outside its own bytes are disallowed.
- **No encryption or passwords.** A PDF/A has to stay readable by an archival system indefinitely — a password only the original author remembers defeats that.
- **No embedded JavaScript or code-executing interactive forms.** Executable content is a moving target future viewers may refuse to run at all.
- **Defined color spaces.** Colors must be specified so they render consistently regardless of monitor, printer, or color-management setup, typically via an embedded ICC profile.

None of this changes what the document looks like to someone reading it right now. It changes what happens when nobody has touched the file in fifteen years and the software that made it no longer exists.

## Who Actually Needs This

Almost nobody needs PDF/A for a document they'll reference for a few months. It exists for records with genuinely long retention requirements:

- **Courts and government agencies**, where a filed document may need to be legible in litigation decades later.
- **Libraries and archives**, which explicitly plan for formats to outlive the software that created them.
- **Regulated industries** — healthcare, finance, insurance — with retention periods set by law, sometimes running decades.
- **Engineering and construction records**, where a document tied to a building or piece of infrastructure needs to stay readable for that structure's lifetime.

If you're emailing an invoice, sharing a resume, or sending someone a PDF they'll read this week, PDF/A adds nothing — it solves a problem you don't have. If a records system, a court's e-filing portal, or a compliance requirement specifically asks for PDF/A, that's the actual point where it matters.

## Metadata Tagging vs. a Full Conversion

Here's the part worth being precise about, because "convert to PDF/A" gets used loosely: there's a real difference between *adding the PDF/A identification metadata* to a document and *fully converting* it to comply with every ISO 19005 requirement above.

Adding the metadata is fast — it's a matter of embedding an XMP identification block that declares "this document claims to be PDF/A." A full conversion additionally has to verify every font is genuinely embedded, convert or tag color spaces correctly, and strip anything the standard disallows. That's a heavier, slower process, and getting it wrong — claiming PDF/A compliance without actually meeting the requirements — can be worse than not claiming it at all, since a system trusting the metadata will file the document as archival-safe when it isn't.

If a document only needs to *look* tagged as PDF/A for a system that checks the metadata but doesn't run a strict validator, quick tagging is enough. If it needs to pass formal PDF/A validation — a court filing, a regulated archive with a real acceptance check — it needs a genuine conversion, not just the label. [FileCast's PDF to PDF/A tool](/convert/pdf-to-pdfa/) does the former: it adds the identification metadata entirely in your browser, in seconds, with nothing uploaded. It's the right tool when tagging is what's actually being asked for, and the wrong one when a document has to survive a formal validator like veraPDF.

## The One-Sentence Version

A PDF is built to look right today. A PDF/A is built to look right on hardware and software that doesn't exist yet — and that guarantee only matters for documents that actually need to survive that long.
