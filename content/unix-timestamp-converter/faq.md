## Frequently Asked Questions

### Is my data uploaded anywhere?

No. Every conversion happens entirely in your browser — nothing is sent to any server.

### How does the tool know if my number is in seconds or milliseconds?

It checks the magnitude: any value of 1,000,000,000,000 (10^12) or more is treated as milliseconds, since a seconds-based timestamp wouldn't reach that many digits until the year 33658. Values below that threshold are treated as seconds.

### Can I convert a date string, not just a numeric timestamp?

Yes. If a line isn't all digits, the tool tries to parse it as a date (ISO 8601 formats like `2024-01-15T12:00:00Z` work reliably; many other common formats work too, depending on your browser).

### What does "Local" mean in the output?

It's the date and time in your device's own time zone setting, computed by your browser — the same time zone your operating system clock uses. It'll show a different value for two visitors in different time zones converting the same timestamp.

### Can I convert multiple timestamps at once?

Yes — put each timestamp or date on its own line, and every line is converted in one pass.
