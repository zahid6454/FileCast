## What Is a Unix Timestamp?

A Unix timestamp (or "epoch time") is a single number representing a moment in time: the number of seconds that have elapsed since January 1, 1970, 00:00:00 UTC. Many systems use milliseconds instead of seconds for extra precision, which is the same idea, just multiplied by 1,000.

It's a compact, timezone-free way to store a date — no parsing ambiguity, no locale formatting differences, just one number that means exactly one instant everywhere in the world.

### Why Use Unix Timestamps?

Storing a date as a single integer avoids the headaches of string date formats (is `01/02/2024` January 2nd or February 1st?) and sidesteps timezone confusion entirely, since a timestamp is always relative to UTC. Databases, APIs, and logs favor them for exactly this reason — they're unambiguous and easy to sort, compare, and do arithmetic on.

### How This Tool Works

Paste one or more timestamps or dates, one per line, and click Convert. This tool detects whether each line is a timestamp (auto-distinguishing seconds from milliseconds) or a date string, then shows every common representation — Unix seconds, Unix milliseconds, ISO 8601, UTC, and your local time. Everything runs in your browser; nothing is uploaded to any server.
