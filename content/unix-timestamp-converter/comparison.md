## Unix Timestamp vs. Human-Readable Date

| Feature | Unix Timestamp | Human-Readable Date (e.g. ISO 8601) |
|---|---|---|
| Format | A single integer | A formatted string |
| Timezone handling | Always UTC-relative, unambiguous | Depends on format — may need an explicit offset |
| Easy to sort/compare | Yes (just compare numbers) | Only if formats match exactly |
| Human readable | No | Yes |
| Common uses | Databases, APIs, logs, `git log` timestamps | UI display, documents, human communication |

### Use a Unix Timestamp When

- Storing a date in a database column or passing it through an API
- You need to sort, compare, or do arithmetic on dates efficiently
- Timezone ambiguity would otherwise be a problem

### Use a Human-Readable Date When

- Displaying a date to a person in a UI or document
- Writing a date into a config file, email, or log message meant to be read directly
