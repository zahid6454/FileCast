## TSV vs CSV — When to Use Each

| Feature | TSV | CSV |
|---|---|---|
| Delimiter | Tab character | Comma |
| Quoting needed for delimiter in data | Rarely (tabs are uncommon in real data) | Often (commas are common in real data) |
| Default export format | Databases, command-line tools | Spreadsheets, most import/export tools |
| Tool support | Narrower | Nearly universal |
| Readability in a plain text editor | Columns don't visually align without a monospace font | Similar |

Both formats do the same job — the difference is almost entirely about which one the tool on the other end expects.

### Keep TSV When

- You're passing data between command-line tools or scripts that already expect tabs.
- Your data commonly contains commas, and you'd rather avoid comma-quoting entirely.

### Convert to CSV When

- You're importing into a spreadsheet app or database tool that expects comma-delimited files specifically.
- An API or upload form says "CSV" and rejects tab-delimited input.
- You want the more broadly recognized format for sharing with someone else.
