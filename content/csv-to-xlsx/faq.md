## Frequently Asked Questions

### Is it safe to convert my data here?

Yes. This tool runs entirely in your browser. Your CSV is read and processed on your own device — nothing is uploaded to a server. Once you close or refresh the page, the data is gone.

### Is the output a real Excel file, or a renamed CSV?

It's a genuine `.xlsx` file — the same ZIP-based format Excel itself produces — not a CSV with a different file extension. It opens directly in Excel, Google Sheets, or LibreOffice Calc with no import prompt.

### Does the first row become a header?

The first row is written to the spreadsheet exactly like every other row — as the first row of cells. If your CSV has a header row, it will simply appear as row 1 in Excel, which is how most CSV exports are already structured.

### How are numbers and leading-zero values handled?

Values that look like ordinary numbers (`42`, `-3.5`) are stored as real numbers, so sums and formulas work immediately. A value with a leading zero — like a ZIP code (`00501`) — is preserved as text instead of losing that leading digit, unlike Excel's own CSV import.

### Does the output include formatting, formulas, or multiple sheets?

No. The output is a single plain sheet with your data in cells — no bold headers, colors, or formulas. If you need formatting, that's easy to add once you have it open in Excel.
