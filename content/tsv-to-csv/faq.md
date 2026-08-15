## Frequently Asked Questions

### Is it safe to convert my data here?

Yes. This tool runs entirely in your browser. Your file is read and processed on your own device — nothing is uploaded to a server. Once you close or refresh the page, the data is gone.

### What if a value already contains a comma?

Any value that contains a comma, a quote character, or a newline is automatically wrapped in double quotes in the output, exactly as the CSV standard (RFC 4180) requires. This keeps the converted file valid even when your data has commas of its own.

### What if my TSV file has quoted fields?

Quoted fields are supported. If a value in your TSV data is wrapped in double quotes — including quotes containing a literal tab or newline — the tool parses it correctly rather than splitting it apart.

### Does the first row need to be a header row?

No. This tool converts every row the same way, whether or not the first one is a header. If your data has a header row, it will simply become the first row of the resulting CSV.

### Can I convert multiple files at once?

This tool processes one file at a time. If you have several TSV files to convert, run each one through individually so you can review each result before moving on to the next.
