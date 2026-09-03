## Common Scenarios for Diffing JSON

<div class="scenario-list" markdown="1">
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-upload-cloud"></use></svg></div>
<div class="scenario__body" markdown="1">

### Comparing Two API Responses

When an API's response changes between versions or environments, a structural diff shows exactly which fields were added, removed, or changed — without false positives from the two responses simply serializing their keys in a different order.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg></div>
<div class="scenario__body" markdown="1">

### Reviewing a Config Change

Before merging an update to a JSON config file, diffing the old and new versions confirms exactly what's changing, which is especially useful when the file was also reformatted at the same time and a plain text diff would show the whole file as different.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg></div>
<div class="scenario__body" markdown="1">

### Debugging a Test Failure

When an assertion compares two JSON objects and fails, pasting both sides here shows precisely which field diverged instead of leaving you to compare two large printed objects by eye.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></div>
<div class="scenario__body" markdown="1">

### Auditing a Data Migration

After migrating data between systems, diffing a sample record's before-and-after JSON confirms the migration preserved every field correctly, and flags anything that was dropped, added, or transformed unexpectedly.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-refresh"></use></svg></div>
<div class="scenario__body" markdown="1">

### Tracking Down an Unexpected State Change

When a JSON blob (a Redux store snapshot, a saved settings object) changes unexpectedly between two points in time, diffing the two snapshots pinpoints exactly which field changed. If you're archiving both snapshots for a report, our [PDF Compressor](/convert/pdf-compress/) keeps the accompanying PDF write-up small.

</div>
</div>
</div>
