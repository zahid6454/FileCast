## Common Scenarios for Minifying JSON

<div class="scenario-list" markdown="1">
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></div>
<div class="scenario__body" markdown="1">

### Shrinking a Config File Before Deployment

A formatted config file baked into a Docker image or a serverless deployment package adds up across thousands of deploys. Minifying it before shipping trims that overhead for no functional cost.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-upload-cloud"></use></svg></div>
<div class="scenario__body" markdown="1">

### Reducing API Payload Size

If you're hand-assembling a JSON payload for a request rather than letting a library serialize it, minifying it before sending shaves off the whitespace bytes that a formatted version carries — small per request, but real at scale.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></div>
<div class="scenario__body" markdown="1">

### Embedding JSON Inside Another File

When JSON is embedded as a string literal inside a JS bundle, an HTML data attribute, or a build artifact, a formatted version brings its indentation along for the ride. Minifying it first keeps the surrounding file lean.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg></div>
<div class="scenario__body" markdown="1">

### Storing JSON in a Database or Cache

A JSON blob stored in a database column or cache entry is never read directly by a person — minifying it before storage saves space with zero downside.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-file-plus"></use></svg></div>
<div class="scenario__body" markdown="1">

### Preparing a Compact Example for a Ticket

Sometimes you want the opposite of readable — a single-line JSON blob that's easy to paste into a command, a URL parameter, or a one-line log entry. If you're also trimming down images for the same bug report, our [Bulk Image Compressor](/convert/bulk-image-compress/) does the same job for screenshots.

</div>
</div>
</div>
