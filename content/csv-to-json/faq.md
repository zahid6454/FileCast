## Frequently Asked Questions

### Is it safe to convert my data here?

Yes. This tool runs entirely in your browser. Your file is read and processed on your own device — nothing is uploaded to a server, and no data is transmitted over the internet. Once you close or refresh the page, the data is gone. This makes it safe for sensitive information like financial records, customer lists, or internal reports.

### Does the first row become field names?

Yes. The tool treats the first row of your CSV as a header row. Each value in that row becomes a key in the resulting JSON objects, and the rows below become the corresponding values. For example, a header of "name,email,city" produces objects with "name," "email," and "city" as their fields.

### How are numbers handled?

Numeric values are detected automatically during conversion. If a cell contains a value that looks like a number — such as 42 or 3.14 — it is stored as a number in the JSON output rather than a quoted string. This means you can use the converted data in calculations or comparisons without needing to parse strings yourself.

### What if my CSV uses semicolons instead of commas?

Common delimiters are supported. Many European systems export CSV files using semicolons, tabs, or pipes instead of commas. This tool recognizes those variations and handles them correctly, so you do not need to find-and-replace characters before converting.

### Can I convert multiple files at once?

This tool processes one file at a time. If you have several CSV files to convert, run each one through individually. This keeps the process straightforward and ensures you can review each result before moving on to the next.
