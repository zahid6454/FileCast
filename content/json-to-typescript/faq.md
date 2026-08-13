## Frequently Asked Questions

### Is my JSON uploaded anywhere?

No. Generation happens entirely in your browser — nothing is uploaded to any server.

### How are nested objects named?

Each nested object gets an interface named after its property key (for example, an `address` field becomes an `Address` interface). If two different nested objects would generate the same name, a number is appended to keep them distinct.

### How does this handle arrays?

Array types are inferred from the **first element only**. If your JSON has an array of objects, the tool generates one interface from the first item's shape and types the array as that interface's plural (`Item[]`). If later items in the array have different fields, those won't be reflected — check the output against your full dataset for critical use cases.

### Are any fields marked optional?

No. Every field in the generated interface is required (no `?:`), since a single JSON sample can't show which fields are sometimes missing. If you know a field is optional from context, add the `?` by hand after generating.

### What if my top-level JSON is just a number, string, or array of primitives?

The tool still generates a valid `type RootObject = ...;` alias — for example, `type RootObject = string[];` for a plain array of strings — rather than requiring the root to be an object.
