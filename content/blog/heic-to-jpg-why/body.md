## A Photo That Won't Open Anywhere Else

If you've ever AirDropped or emailed a photo from an iPhone to a Windows PC, an Android phone, or an older piece of software, and gotten back a file that won't open — or opens as a gray box, or gets flagged as an "unsupported format" — the file was very likely a `.heic`. Nothing about your photo is broken. It's just saved in a format most of the world outside Apple's own ecosystem doesn't natively understand.

## What HEIC Actually Is

HEIC (High Efficiency Image Container) is Apple's implementation of HEIF (High Efficiency Image Format), and it's been the default photo format on iPhones and iPads since iOS 11, released in 2017. Structurally it isn't just "a smaller JPG" — it uses a completely different, more modern compression method (based on the same underlying technology as HEVC/H.265 video compression), which is what lets it store a photo at roughly half the file size of an equivalent-quality JPG. It also supports things JPG's decades-old spec has no room for at all: transparency, image sequences (how Live Photos work), depth-map data (used for portrait-mode background blur), and multiple images bundled into a single file.

## Why Apple Defaults to It

The file-size savings are the real driver. Modern phone cameras produce enormous images — a single 48-megapixel photo can run several megabytes even compressed — and multiplied across the thousands of photos a typical user accumulates, HEIC's roughly 50% size reduction over JPG at similar visual quality adds up to meaningfully more photos fitting in the same iCloud storage tier or on-device capacity. Apple controls both ends of the pipeline — the camera hardware, the OS, and the Photos app that displays HEIC files — so switching carried no ecosystem-compatibility cost from Apple's side. Inside Apple's own ecosystem you'd likely never notice HEIC exists at all, since Photos, Messages, and AirDrop all display it transparently.

## Where It Breaks Down

The moment a HEIC file leaves Apple's ecosystem, that transparency disappears. Windows only gained native HEIC support in later versions, and even then it often requires an extra codec pack from the Microsoft Store. Most Android devices don't render it at all. Plenty of still-widely-used web browsers, email clients, and photo-editing tools were built assuming JPG or PNG and simply don't recognize the format — you'll get a broken-image icon, a failed upload, or a flat "file format not supported" error. Social media platforms and many web forms that accept photo uploads have the same gap. None of this is a bug on your end. It's the ordinary cost of one company adopting a format years before the rest of the software world caught up.

## What You Gain and Lose Converting to JPG

Converting HEIC to JPG is a trade in one clear direction: you gain universal compatibility — every device, browser, platform, and piece of software built in the last 25 years can open a JPG — at the cost of some of HEIC's format-level advantages. The resulting file gets larger, since JPG's older compression is less efficient at the same visual quality, and Live Photo motion, depth-map data, and true transparency don't survive the conversion, because JPG's specification has no field to store any of them. For the ordinary case — sharing a still photo with someone whose device can't open HEIC — none of that lost data was going to be used anyway; you're trading a size and feature advantage that only matters inside Apple's ecosystem for compatibility everywhere else.

## When You Actually Need to Convert

If you're staying entirely within Apple devices — iPhone to iPhone, iPhone to Mac, iPhone to iPad — there's genuinely no reason to convert anything; HEIC displays natively everywhere in that chain, and converting would only cost you file size and metadata for no benefit. The moment a photo needs to reach a Windows PC, an Android device, most web upload forms, or software you're not certain has current HEIC support, converting to JPG — or PNG, if you specifically need to preserve transparency — removes the guesswork entirely. It's a one-way trade worth making exactly once, at the point the photo is about to leave the ecosystem it was created in, not before.
