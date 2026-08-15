## Common Scenarios for TSV to CSV Conversion

### Importing a Database Export into a Spreadsheet

Many databases and BI tools export query results as TSV by default. When you need to open that export in Excel or Google Sheets, or hand it to someone who expects a "CSV file," converting the delimiter first avoids a garbled single-column import.

### Uploading to a Tool That Only Accepts CSV

Plenty of upload forms and APIs are labeled "CSV upload" but reject tab-delimited files outright, even though the data is otherwise identical. Converting your TSV export to CSV first is often the quickest fix, faster than re-exporting from the original source if that option isn't readily available.

### Feeding Command-Line Output into a Spreadsheet Workflow

Command-line tools (cut, awk, database CLIs) commonly output tab-separated data. If the next step in your workflow is a spreadsheet or a CSV-based pipeline, converting bridges that gap without needing to rewrite the original export.

### Assembling a Final Report

If you're combining a converted CSV export with a cover page or written summary into a single deliverable, our [PDF Merge](/convert/pdf-merge/) tool can combine multiple PDFs into one document once each piece is ready.

### Standardizing Mixed-Format Data Exports

When you're collecting exports from several different sources — some TSV, some already CSV — converting everything to CSV first gives you one consistent format to work with before combining or processing the data further.
