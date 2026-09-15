## The Logo That's Never Actually Blurry

Zoom into a company's logo on their website — sometimes it stays razor-sharp no matter how far you zoom, and sometimes it turns into a soft, pixelated mess past a certain point. The difference isn't image quality settings. It's whether the file is a raster image (PNG) or a vector image (SVG), and those two formats represent an image in fundamentally different ways.

## Pixels vs. Math

A PNG is a fixed grid of colored pixels — a specific number of them, set at the moment the file was created. Zoom in far enough and you'll eventually see the individual squares, because there's no more detail beyond what was originally captured. An SVG contains no pixel grid at all — it's a set of shapes described mathematically (paths, curves, coordinates), which a renderer recalculates fresh at whatever size it's displayed. There's no "original resolution" to run out of, because the shape is being redrawn from its formula every time, not scaled from a fixed grid.

## Why SVG Wins for Logos and Icons

A logo needs to look identical on a business card, a website header, and a billboard — three wildly different sizes from one source file. A raster logo forces a choice: export it large enough for the biggest use case (wasting file size everywhere smaller) or export multiple versions at different sizes (more files to manage and keep in sync). An SVG sidesteps the tradeoff entirely — one file, perfectly sharp at every size, because it's not scaling a fixed grid, it's redrawing shapes.

SVGs are also just text under the hood (XML), which makes them tiny for simple logos and icons — often smaller than an equivalent PNG — and editable directly in a text editor or a vector tool like Illustrator, shape by shape.

## Where PNG Still Wins

The moment an image has genuine photographic detail — gradients, textures, thousands of subtle color variations — vector shapes stop being a good fit, because a path can't represent a smooth gradient the way a pixel grid naturally can. That's why photos stay PNG or JPG territory, not SVG. And plenty of software and platforms still expect a raster format specifically — a favicon spec, an app icon slot, a form upload that only accepts PNG/JPG — where SVG simply isn't accepted regardless of its technical advantages.

## Converting Between Them

Going from vector to raster is exact and lossless — [FileCast's SVG to PNG tool](/convert/svg-to-png/) renders a vector logo at whatever pixel size you need, with no quality loss, since you're rendering the math at a fixed resolution rather than approximating anything. Going the other direction is fundamentally an approximation: [PNG to SVG](/convert/png-to-svg/) traces a raster image into vector shapes, which works cleanly for flat logos and icons with well-defined color regions, but won't reproduce a photo's gradients and detail, since a vector shape simply can't represent that kind of continuous variation.

## The One-Sentence Version

SVG stays sharp at any size because it's redrawn from math, not scaled from a fixed pixel grid — which makes it the better choice for logos and icons, and the wrong choice for anything with photographic detail.
