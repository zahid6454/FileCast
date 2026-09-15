## The Double-Click That Doesn't Work

You plug in an iPhone, copy photos over, and double-click one — and Windows either shows a blank thumbnail, a "can't open this file" error, or a generic icon with no preview at all. This isn't a corrupted transfer. iPhones save photos as HEIC by default, and Windows Photo Viewer doesn't understand that format out of the box.

## Why Windows Doesn't Just Support It

HEIC's compression is built on the same underlying technology as HEVC (H.265) video — and HEVC decoding has historically carried patent-licensing costs that Microsoft didn't want baked into every Windows install for free. So Windows splits HEIC support into two separate, optional Microsoft Store add-ons: the "HEVC Video Extensions" and the "HEIF Image Extensions." The HEIF piece is normally free, but it depends on the HEVC codec being present — and on many PCs that codec is a paid download (sometimes bundled free by the PC manufacturer, sometimes not), which is why HEIC support on Windows is inconsistent from one machine to the next even among people running the same Windows version.

## What the Codec Actually Fixes — and What It Doesn't

Installing both extensions does get Windows Explorer and Photos to preview and open HEIC files. What it doesn't do is make HEIC work everywhere else you'd want to use that photo: uploading it to a web form that only accepts JPG/PNG, attaching it in an email client that doesn't render it for the recipient, or pasting it into software built years before HEIC existed. The codec fixes your local viewing experience; it does nothing for anyone or anything downstream that still can't read the format.

## Converting Sidesteps Both Problems at Once

Converting the file to JPG solves the local viewing issue without installing anything, and it solves the downstream compatibility issue too — a JPG opens correctly for you, for whoever you send it to, and in software that's never heard of HEIC. It's also the only fix that matters if you're not even the one who installs software on the machine in question (a shared PC, a work laptop with locked-down Store access).

## How to Do It Without Installing Anything

[FileCast's HEIC to JPG converter](/convert/heic-to-jpg/) runs entirely in your browser — no codec, no Store download, and no file leaves your computer. Drop the HEIC file in, and it comes back as a JPG that opens on any Windows PC, any Android phone, and any software built in the last two decades. If you need PNG instead (for transparency, or a workflow that specifically wants it), [HEIC to PNG](/convert/heic-to-png/) does the same conversion with that output format.

## The One-Sentence Version

Windows' HEIC support is a paid, inconsistent codec install that only fixes your own machine — converting the file once fixes it everywhere, for free, with nothing to install.
