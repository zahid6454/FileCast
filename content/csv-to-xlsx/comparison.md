## CSV vs XLSX — When to Use Each

| Feature | CSV | XLSX |
|---|---|---|
| File type | Plain text | Real spreadsheet binary format |
| Opens directly in Excel | With an import prompt | Instantly, no prompt |
| Cell types (number vs. text) | Not stored — guessed on import | Stored explicitly per cell |
| Formulas, multiple sheets, formatting | Not supported | Supported |
| File size | Smaller | Larger |
| Best uses | Data exchange, scripts, version control | Sharing a ready-to-use spreadsheet |

CSV is the simplest, most portable way to move tabular data between systems. XLSX is the format to hand someone who's going to open it directly in Excel and start working.

### Keep CSV When

- You're feeding the data into a script, API, or database import that expects plain text.
- You want the file to be readable in any text editor and to diff cleanly in version control.
- File size matters more than native spreadsheet features.

### Convert to XLSX When

- You're sending the file to someone who will open it directly in Excel, Google Sheets, or LibreOffice Calc.
- You want numbers to behave as numbers immediately, without an import step.
- You need the recipient to skip Excel's CSV import prompt entirely.
