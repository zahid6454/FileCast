## Common Scenarios for Diffing JSON

### Comparing Two API Responses

When an API's response changes between versions or environments, a structural diff shows exactly which fields were added, removed, or changed — without false positives from the two responses simply serializing their keys in a different order.

### Reviewing a Config Change

Before merging an update to a JSON config file, diffing the old and new versions confirms exactly what's changing, which is especially useful when the file was also reformatted at the same time and a plain text diff would show the whole file as different.

### Debugging a Test Failure

When an assertion compares two JSON objects and fails, pasting both sides here shows precisely which field diverged instead of leaving you to compare two large printed objects by eye.

### Auditing a Data Migration

After migrating data between systems, diffing a sample record's before-and-after JSON confirms the migration preserved every field correctly, and flags anything that was dropped, added, or transformed unexpectedly.

### Tracking Down an Unexpected State Change

When a JSON blob (a Redux store snapshot, a saved settings object) changes unexpectedly between two points in time, diffing the two snapshots pinpoints exactly which field changed. If you're archiving both snapshots for a report, our [PDF Compressor](/convert/pdf-compress/) keeps the accompanying PDF write-up small.
