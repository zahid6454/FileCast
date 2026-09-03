## What Is JSON?

JSON stands for JavaScript Object Notation. It is a lightweight text format used to store and exchange data between systems. Nearly every modern application, website, and API uses JSON to move information around.

A JSON file organizes data using a simple set of building blocks. Objects hold key-value pairs wrapped in curly braces, arrays hold ordered lists wrapped in square brackets, and values can be text, numbers, booleans, or other nested objects. This flexibility makes JSON the go-to choice for representing everything from user profiles to product catalogs.

Here is a quick example of what JSON looks like:

```json
{
  "name": "Alice",
  "age": 30,
  "city": "Toronto"
}
```

Because JSON can nest data many levels deep, it works well for complex structures. However, that same nesting can make it difficult to browse, sort, or analyze the data in a spreadsheet.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
    <span class="stat-tile__label">Keys become columns</span>
    <span class="stat-tile__sub">Each record becomes a row</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg></span>
    <span class="stat-tile__label">Opens in any spreadsheet</span>
    <span class="stat-tile__sub">Excel, Google Sheets, LibreOffice</span>
  </div>
</div>

### Why Convert to CSV?

CSV (Comma-Separated Values) is the universal format for tabular data. When you convert JSON to CSV, each key becomes a column header and each record becomes a row. This makes the data easy to open in Excel, Google Sheets, or any spreadsheet application.

Common reasons to convert include:

- Running filters, sorts, or pivot tables on API response data
- Importing records into a database or reporting tool
- Sharing structured data with teammates who prefer spreadsheets
- Preparing datasets for charts and visualizations

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This tool converts your JSON to CSV <strong>entirely inside your browser</strong>. Your data never leaves your device — there is no upload to any server. Simply paste or load your JSON, and the conversion happens instantly on your machine. Once the CSV is ready, you can download it or copy it to your clipboard right away.</p>
</div>
