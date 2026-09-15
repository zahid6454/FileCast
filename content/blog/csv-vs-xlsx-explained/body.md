## The Zip Code That Loses Its Zero

You open a CSV of customer records in Excel and notice every zip code starting with a zero — 07030, 02134 — has quietly lost it, now reading 7030 and 2134. Nothing corrupted the file. Excel did exactly what it's designed to do with a CSV: guess what kind of data each column holds, and it guessed "number" for a column of digits, which strips leading zeros the same way it would for any number you typed in yourself.

## A CSV Doesn't Know What Its Data Is

A CSV (comma-separated values) file is just plain text — rows of values separated by commas, nothing more. It has no concept of a column type, a date format, or a number format, because it has no formatting information at all; it's the plainest possible way to represent a table. That simplicity is exactly why it's so widely supported — but it also means every program that opens a CSV has to *guess* what each value means, with no metadata to guide the guess.

## Where the Guessing Goes Wrong

Excel's guesses are reasonable most of the time and wrong in a few specific, recurring ways:

- **Leading zeros disappear** — a zip code, a product SKU, or an account number starting with 0 gets treated as a number and silently truncated.
- **Dates get reformatted** — a value like "03-04" meant as a code or a fraction can get reinterpreted as a date and rewritten into Excel's default date format.
- **Large numbers turn into scientific notation** — a long ID or barcode number past about 15 digits gets displayed as `1.23457E+14`, and the original precision may not be recoverable once that happens.
- **Encoding issues garble special characters** — accented letters or non-English text can render as garbled symbols if the CSV's text encoding doesn't match what Excel assumes by default.

None of this is a bug in the CSV — the file is doing exactly what it says on the label. It's Excel's type-guessing running into data a plain-text format was never able to specify a type for in the first place.

## Why XLSX Doesn't Have This Problem

XLSX, Excel's native format, isn't plain text — it's a structured file format that stores each cell's actual type alongside its value: this column is text, this one is a date in this specific format, this one is a number with this many decimal places. There's no guessing involved because the format information is already in the file. A zip code column saved as text in an XLSX stays text, zeros and all, because the file explicitly says so.

Converting a CSV to XLSX before opening it doesn't fix data that's already been garbled by a previous open in Excel, but it prevents the garbling from happening in the first place — [FileCast's CSV to XLSX tool](/convert/csv-to-xlsx/) turns CSV data into a real .xlsx workbook in your browser, so the values land in Excel, Google Sheets, or LibreOffice exactly as written. If you're feeding the data into code instead of a spreadsheet, [CSV to JSON](/convert/csv-to-json/) sidesteps the type-guessing problem entirely by handing off structured data your program can parse deliberately.

## The One-Sentence Version

A CSV has no way to say "this column is text, not a number" — so Excel guesses, and converting to XLSX first removes the guess by storing the type explicitly.
