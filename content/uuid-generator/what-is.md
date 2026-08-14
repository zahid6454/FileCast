## What Is a UUID?

A UUID (Universally Unique Identifier) is a 128-bit value, usually written as 32 hex characters split into five groups, like `f47ac10b-58cc-4372-a567-0e02b2c3d479`. It's designed so that generating one anywhere, at any time, is astronomically unlikely to collide with any other UUID ever generated — no central registry or coordination required.

This tool generates version 4 UUIDs, the most common variant: every UUID is built from a cryptographically random number generator, not derived from a timestamp or hardware identifier.

### Why Use UUIDs?

Auto-incrementing integer IDs (1, 2, 3, ...) are simple but reveal how many records exist, are easy to guess, and collide instantly if you ever merge data from two separate sources. A UUID sidesteps all three problems: it's unguessable, doesn't leak volume information, and can be generated independently by any number of systems without ever needing to check in with each other.

### How This Tool Works

Type how many UUIDs you want (1 to 100) and click Generate. Each one is created with your browser's built-in cryptographically secure random number generator (`crypto.randomUUID()`) — the same standard used by databases and programming languages. Nothing is uploaded to any server; the values never leave your browser.
