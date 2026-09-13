## Two Promises That Sound Identical

Almost every file-conversion site makes some version of a privacy promise. Two of the most common ones read almost the same on a landing page:

> "We delete your file after 24 hours."

> "We never receive your file."

They sound like two ways of saying "your file is safe with us." They aren't. One describes what happens *after* your file has already been copied to someone else's server. The other describes a process where your file is never copied anywhere in the first place. The gap between those two is the entire point of this post.

## What "Deleted After 24 Hours" Actually Means

A tool that promises deletion after a fixed window is, by definition, a tool that uploads your file. For that window — 24 hours, an hour, "immediately" — your file exists on a server you don't control, readable by whatever process runs there, potentially logged by whatever infrastructure sits in front of it (load balancers, CDNs, error-monitoring tools that capture request bodies), and subject to whatever that company's backup schedule does before the deletion job actually runs. "Deleted after 24 hours" is a real commitment, and plenty of services honor it. But it's a commitment about what happens *after* the file has already left your device — not a claim that it never left.

## What "Never Uploaded" Actually Means

A tool that runs entirely in your browser is a different architecture, not just a faster deletion policy. When a conversion happens client-side — JavaScript running on your own device, sometimes backed by WebAssembly for heavier decoding work — your file is read into your browser's memory, transformed there, and handed back to you as a download. It never becomes a network request. There's no server log to purge and no backup to expire, because there was never a copy anywhere to begin with. You can verify this yourself: open your browser's network inspector while converting a file on a genuinely client-side tool, and you'll see the conversion happen with no outgoing request carrying your file's contents.

## Why This Difference Matters More Than It Sounds

For a vacation photo you're resizing, the difference is mostly philosophical. For a scanned tax document, a contract with a client's name on it, a photo of an ID, or a screenshot of something you'd rather not have sitting on a stranger's disk even briefly, the difference is the entire risk profile. "Deleted after 24 hours" still means the file existed, at least briefly, on infrastructure you're trusting a company's operational discipline to secure. "Never uploaded" removes that infrastructure from the equation entirely — there's nothing on someone else's server to be breached, subpoenaed, or accidentally left in a log file, because it was never there.

## How to Tell Which One a Tool Actually Uses

Marketing copy alone isn't reliable evidence either way — "secure," "encrypted," and "private" all get used loosely regardless of the actual architecture behind them. Two things are harder to fake:

- **The network tab.** If converting a large file produces no outgoing upload matching the file's size, the conversion is running locally.
- **Does it still work with your network disconnected?** A genuinely browser-based tool will often still convert a file with Wi-Fi turned off (once the page itself has loaded), because there's nothing left to talk to.

On FileCast specifically, every tool is labeled with a badge for exactly this reason: a green **Local** badge — used across converters like [PNG to JPG](/convert/png-to-jpg/), [PDF Merge](/convert/pdf-merge/), and [Image Compress](/convert/image-compress/) — means the conversion happens entirely in your browser and nothing is uploaded. A blue **Cloud** badge — used by a small number of tools like [PDF Compress](/convert/pdf-compress/) — means that specific tool needs a server round trip, in which case the file is deleted immediately after conversion rather than retained on any schedule.

## The Honest Caveat

Not every kind of file processing can run in a browser. Some formats and operations genuinely need more memory or compute than a browser tab can reliably provide, or depend on a library that only exists outside the browser sandbox. That's a real, non-negotiable constraint, not an excuse to cut corners — it's why a handful of tools legitimately have to be server-side at all, and why the honest answer for those is "uploaded and deleted immediately," not a pretense that they're something they're not.
