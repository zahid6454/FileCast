## Optimized vs Original SVG — What Changes

An optimized SVG renders identically to the original — the difference is entirely in what's stripped out of the underlying XML, not in what you see.

| Feature | Original SVG | Optimized SVG |
|---|---|---|
| Visible rendering | As exported | Identical — no visual changes |
| File size | Includes editor cruft | Smaller — cruft removed |
| Comments | Often present | Removed |
| Editor metadata | Design-tool-specific fields (Inkscape, Sodipodi, etc.) | Removed |
| Path/shape data | Unchanged | Unchanged — geometry is never modified |
| Readability | Can be cluttered if opened in a code editor | Cleaner if you need to read or edit it by hand |

### Keep the Original When

- You're actively editing the file in a design tool that relies on its own metadata (like Inkscape's `sodipodi:` fields for undo history or guides)
- File size genuinely doesn't matter for your use case

### Optimize When

- You're publishing the SVG on a website and want it to load as fast as possible
- You're embedding the SVG inline in HTML and want to keep the markup clean
- You're distributing an icon or logo and don't want to also ship the design tool's internal bookkeeping
- You want a smaller file with zero visual difference
