## Common Scenarios for Generating Hashes

### Verifying a Downloaded File Hasn't Been Corrupted or Tampered With

Software publishers often list an MD5 or SHA-256 checksum next to a download link. After downloading, hashing the file yourself and comparing it to the published value confirms the file arrived intact — and, for SHA-256, that it hasn't been swapped for something malicious in transit.

### Checking That a File Survived a Conversion Unchanged

If you've just compressed a file with our [PDF Compressor](/convert/pdf-compress/) or another tool and want to confirm nothing was silently altered beyond the intended change, hashing the file before and after (where the format itself is expected to stay byte-identical) is a quick sanity check.

### Generating a Cache Key or Deduplication Key

Hashing a piece of content — a request body, a file, a block of text — gives you a short, fixed-length key you can use to detect duplicates or invalidate a cache entry when the underlying content changes, without storing or comparing the full content itself.

### Creating a Git-Style Content Fingerprint

Git famously identifies every commit and file blob by its SHA hash. The same idea applies outside Git: a SHA-256 hash gives you a compact, verifiable fingerprint for any piece of text or data you need to reference unambiguously later.

### Quickly Checking Two Pieces of Text Are Identical

Rather than comparing two long strings character by character, hashing both and comparing the (much shorter) digests is a fast way to confirm — with extremely high confidence — that they're exactly the same.
