# Engineering Quality Review Guide

Checklist for correctness, design, maintainability, performance, and testing.
Load for essentially every review; it's the core craft dimension.

## Contents
- Correctness & edge cases
- Design & architecture
- Maintainability & readability
- Reuse (don't reinvent)
- Performance & scalability
- Testing

## Correctness & edge cases
- Boundary values: empty, single-element, max size, zero, negative, very large.
- Null / undefined / None / missing-key handling on every dereference.
- Off-by-one in indexing, slicing, ranges, and loops.
- Wrong operator or inverted condition; `&&`/`||` and truthiness pitfalls.
- Numeric: integer overflow, float rounding, division by zero, currency as float.
- Text: encoding/Unicode, locale, timezone/DST, case sensitivity.
- Error handling: failures surfaced or handled — not swallowed; no `except:`/
  `catch {}` that hides real problems; cleanup happens on the error path too.
- Async: awaited promises, unhandled rejections, ordering assumptions, races.

## Design & architecture
- Change fits the **existing patterns and conventions** of the codebase (read a
  neighbor file; read CLAUDE.md if present). New inconsistency is a cost.
- Separation of concerns; single responsibility; low coupling, high cohesion.
- Right abstraction level — not premature generalization, not copy-paste that
  should be shared.
- Clear, minimal public interface; backward compatible if others depend on it.
- No leaky abstractions or hidden global state.

## Maintainability & readability
- Names reveal intent; no misleading or single-letter names outside tight scope.
- Functions are a readable size and do one thing; nesting is manageable.
- Comments explain **why**, not restate the code; no commented-out/dead code.
- Duplicated logic is factored where it genuinely repeats (rule of three).
- Magic numbers/strings are named constants.

## Reuse (don't reinvent)
- Check for an existing helper/util/component before adding a new one.
- Reach for the standard library / an already-vendored dependency before custom
  code for solved problems (dates, parsing, crypto, retries).

## Performance & scalability
- Algorithmic complexity acceptable on the hot path; no accidental quadratic
  loops over large inputs.
- No blocking I/O on latency-sensitive paths; batch or parallelize I/O in loops.
- Appropriate caching/memoization where recomputation is expensive — with a
  correct invalidation story.
- Payload/response/query result sizes bounded; new DB queries have supporting
  indexes.
- Reason about behavior at **10x data and 10x traffic**, not just today's.

## Testing
- New logic has tests, including **edge cases and failure paths**, not only the
  happy path.
- Tests assert observable behavior/output, not internal implementation details.
- No flakiness sources: real network/clock/sleep, random without seed, order
  dependence between tests, shared mutable fixtures.
- A regression test accompanies a bug fix.
- Test names describe the scenario; failures would be diagnosable.
