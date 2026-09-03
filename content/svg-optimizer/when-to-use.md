## Common Scenarios for Optimizing an SVG

<div class="scenario-list" markdown="1">
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-upload-cloud"></use></svg></div>
<div class="scenario__body" markdown="1">

### Publishing Icons on a Website

Icon sets exported from a design tool often carry far more markup than the shapes themselves need. Optimizing every icon before deploying them trims unnecessary weight across every page that loads them — and if you're also minifying your site's CSS and JavaScript, FileCast's [CSS/JS Minifier](/convert/css-js-minifier/) handles that side of the same cleanup.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></div>
<div class="scenario__body" markdown="1">

### Embedding SVG Inline in HTML

When an SVG is pasted directly into an HTML page (rather than linked as a file), every extra byte of editor cruft becomes part of the page's own markup. Optimizing first keeps the inlined SVG from bloating your HTML.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-file-plus"></use></svg></div>
<div class="scenario__body" markdown="1">

### Cleaning Up Before Sharing a Design File

If you're handing an SVG off to someone else — a developer, a client, another designer — stripping the editor-specific fields makes the file easier to open cleanly in a different tool that doesn't recognize them.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></div>
<div class="scenario__body" markdown="1">

### Reducing Repo or Asset Bundle Size

Icon libraries and asset folders in a codebase accumulate a lot of small SVGs. Optimizing each one before committing keeps the total asset size down without changing how anything looks.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg></div>
<div class="scenario__body" markdown="1">

### Auditing an SVG's Contents

If you're curious what's actually inside an SVG file you didn't create yourself, stripping the noise first makes it much easier to read the real structure if you open it in a text or code editor afterward.

</div>
</div>
</div>
