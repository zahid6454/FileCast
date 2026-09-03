## Common Scenarios for Generating UUIDs

<div class="scenario-list" markdown="1">
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-upload-cloud"></use></svg></div>
<div class="scenario__body" markdown="1">

### Naming Uploaded Files Without Collisions

When users upload files — photos, documents, attachments — naming each one with a UUID instead of its original filename avoids collisions between two people uploading a file called `photo.jpg`. This matters even more when processing a whole batch at once, like renaming a set of images before running them through our [Bulk Image Compressor](/convert/bulk-image-compress/).

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg></div>
<div class="scenario__body" markdown="1">

### Assigning a Primary Key Before Saving to a Database

Some architectures need an ID assigned before a record is inserted (for example, to reference it in a related record within the same transaction). Generating a UUID client-side or in application code, rather than waiting on an auto-increment value from the database, makes that possible.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg></div>
<div class="scenario__body" markdown="1">

### Creating a Unique Session or Request ID

Tracing a single request through logs across multiple services is much easier when every log line is tagged with the same UUID, generated once at the start of the request.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></div>
<div class="scenario__body" markdown="1">

### Seeding Test or Placeholder Data

When writing tests or building a demo dataset, UUIDs give you realistic-looking unique identifiers without worrying about accidentally reusing a real ID from production data.

</div>
</div>
<div class="scenario" markdown="1">
<div class="scenario__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></div>
<div class="scenario__body" markdown="1">

### Generating API Keys or One-Time Tokens

A UUID's unguessability makes it a reasonable building block for a one-time token or a simple API key, though for anything security-sensitive you'll want to pair it with proper hashing and expiration logic in your backend.

</div>
</div>
</div>
