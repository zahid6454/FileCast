## Frequently Asked Questions

### Is it safe to convert my data here?

Yes. This tool runs entirely inside your browser. Your file is processed on your own device, and no data is uploaded to any server. Nothing leaves your machine at any point during the conversion, so your information stays completely private.

### What happens to nested JSON objects?

Nested objects are flattened into separate columns. For example, if your JSON contains an address object with city and country fields, the output CSV will include columns like address.city and address.country. This approach keeps every piece of data accessible in a flat, spreadsheet-friendly format without losing any information.

### Can I convert any JSON structure?

This tool works best with JSON that contains an array of objects — the most common structure returned by APIs and data exports. Each object in the array becomes a row, and each key becomes a column header. If your JSON uses a different structure, such as a single object or deeply irregular nesting, you may need to adjust it before converting.

### Will my column order be preserved?

Columns in the output CSV follow the order in which keys appear in your JSON data. The first key encountered becomes the first column, the second key becomes the second column, and so on. If different objects in your array have keys in varying orders, the tool uses the order from the first complete object as a reference.

### Can I convert multiple files at once?

This tool handles one file at a time. If you have several JSON files to convert, simply run each one through the converter individually. Each conversion takes only a moment, so processing a handful of files is still quick and easy.
