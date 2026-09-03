## Common Scenarios for Formatting XML

<div class="scenario-list" markdown="1">
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg></div>
<div class="scenario__body" markdown="1">

### Debugging a SOAP or REST/XML Response

Legacy APIs and SOAP services often return XML as one dense line. Formatting it first makes the envelope, headers, and body visible instead of forcing you to count angle brackets.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></div>
<div class="scenario__body" markdown="1">

### Reviewing an Android Layout or Config File

Android's XML layouts, Maven's pom.xml, and Spring config files are frequently reformatted or minified by tooling. Formatting before a code review makes the actual change visible instead of hidden inside a wall of text.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-upload-cloud"></use></svg></div>
<div class="scenario__body" markdown="1">

### Inspecting an RSS or Atom Feed

Feed XML is usually generated with no whitespace at all. Formatting it makes it possible to check that titles, links, and publish dates are landing in the right elements.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-file-plus"></use></svg></div>
<div class="scenario__body" markdown="1">

### Documenting an XML Schema

When writing documentation that includes an XML example, formatted output is far easier for readers to follow than a minified blob, and makes the nesting of child elements obvious.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-refresh"></use></svg></div>
<div class="scenario__body" markdown="1">

### Preparing XML for a Pull Request

If an XML file gets minified by a build step or export tool, formatting it back before committing keeps the diff readable — reviewers can see the specific value that changed. Once your config is readable, our [PDF Merge](/convert/pdf-merge/) tool is handy for combining any supporting PDF documentation you're attaching alongside it.

</div>
</div>
</div>
