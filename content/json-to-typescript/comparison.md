## Hand-Written vs. Generated TypeScript Interfaces

| Feature | Hand-Written | Generated From JSON |
|---|---|---|
| Speed | Slow for large/nested objects | Instant |
| Accuracy | Prone to typos, missed fields | Matches the actual sample exactly |
| Nested objects | Requires manually naming each one | Automatically named and split out |
| Best for | Types that need business logic beyond raw shape (unions, optional fields you know about but the sample doesn't show) | A fast starting point from a real example |

### Write Interfaces by Hand When

- You need fields marked optional (`?:`) that don't appear in every response
- You want precise union types (`"admin" | "user"`) instead of a plain `string`
- The type needs to encode business rules the JSON sample alone can't show

### Generate From JSON When

- You have a real example response and want a fast, accurate starting point
- You're prototyping and just need something usable now, refinable later
- You're documenting an API's actual shape rather than its idealized one
