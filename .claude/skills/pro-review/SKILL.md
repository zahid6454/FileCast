---
name: pro-review
description: >
  Professional engineering + SRE review of a code change, the way a staff
  engineer and an SRE would before approving it for production. Broader than
  bug-hunting: correctness, design, security, reliability/failure-modes,
  observability, performance, testing, and operational readiness, with
  confidence-scored findings and a ship / don't-ship verdict. Use when the user
  asks for a thorough, professional, senior/staff-level, production-readiness,
  SRE, or reliability review of the current branch, a diff, a PR, or specific
  files. Triggers: "pro review", "production readiness", "SRE review",
  "reliability review", "review like a staff engineer", "is this safe to ship".
allowed-tools: Read, Grep, Glob, Bash, WebFetch, TodoWrite
---

# Professional Engineering & SRE Review

Review a change for production, not just for bugs. Go past "does it work" to
"is it correct, safe, observable, and operable at scale."

The detailed checklists live in reference files — load the ones that apply,
don't inline them:
- Craft (correctness, design, maintainability, performance, testing) →
  [reference/engineering.md](reference/engineering.md)
- Reliability / SRE (failure modes, resources, concurrency, migrations,
  observability, rollout) → [reference/reliability-sre.md](reference/reliability-sre.md)
- Security (injection, authz, secrets, CSP, SSRF, weakened controls) →
  [reference/security.md](reference/security.md)

## Workflow

Copy this checklist into your response and work through it:

```
Review progress:
- [ ] Phase 1: Scope + context
- [ ] Phase 2: High-level pass (design, blast radius)
- [ ] Phase 3: Deep pass (load reference guides, go file-by-file)
- [ ] Phase 4: Verify findings, score, deliver verdict
```

### Phase 1 — Scope + context
Determine and **print the exact scope** before reviewing:
- **Current branch (default):** base = `git merge-base origin/master HEAD`
  (fall back to `master`), then `git diff <base>...HEAD`.
- **PR number:** `gh pr diff <n>` + `gh pr view <n>` for description/CI.
- **Named files/paths:** review those, reading enough surroundings to judge them.
- **Uncommitted:** `git diff HEAD` and `git diff`.

Read the intent (commit messages, PR body, linked issues) and the repo's
conventions (CLAUDE.md, neighboring files). Review against intent and existing
patterns, not just syntax. For a large diff, use TodoWrite to track files.

### Phase 2 — High-level pass
Before line detail: is the **approach** sound? Note architecture concerns,
the **blast radius** (one page vs. whole site vs. data integrity vs. a security
boundary), and which dimensions matter most for this change.

### Phase 3 — Deep pass
Go file-by-file. For each changed area, **read the surrounding code and
callers** — most real defects live in the interaction between new and existing
code. Open the reference guides above for the dimensions in play and work their
checklists. Skip dimensions that genuinely don't apply (say which in the output).

### Phase 4 — Verify, score, deliver
See "Verify every finding" and "Output" below.

## Verify every finding

Before reporting anything, confirm it is real — precision over volume:
- Trace a concrete **path to failure**: specific inputs/state → wrong
  output/crash/leak. If you can't construct one, it's a question, not a defect.
- Check whether existing code already handles it (upstream validator, wrapper,
  framework guarantee). Don't report what's already covered.
- Where cheap, **exercise it** (run the test/build/a quick repro) and report what
  you observed; state clearly when you did not.

**Confidence score** each finding 0–100 (0 = likely false positive, 50 = real
but minor, 80 = confident and real, 100 = certain). **Report only ≥ 80 by
default** (the user may ask for a lower bar). Do **not** report: pre-existing
issues not introduced by this change, pedantic nitpicks, purely
linter/formatter-catchable items, or style the repo doesn't follow.

## Severity taxonomy

Blocking tiers:
- 🔴 **blocking** — must fix before merge (correctness, security, data loss,
  reliability regression, weakened control)
- 🟡 **important** — should fix; discuss if you disagree
- 🟢 **nit** — minor, non-blocking

Non-blocking annotations: 💡 **suggestion** (alternative), 📚 **learning**
(context), 🎉 **praise** (call out genuinely good work — briefly).

## Output

Lead with a one-line **verdict**: `Ship it` · `Ship with fixes` · `Do not ship`.
Then group findings by severity (🔴 → 🟡 → 🟢), most severe first. Each finding:

- `path:line` — one-sentence statement of the defect  ·  *(confidence NN, dimension)*
- **Failure scenario:** concrete inputs/state → concrete bad outcome
- **Fix:** the specific change, or the tradeoff to decide

Close with 🎉 what's genuinely good, and one line naming any §checklist
dimension you deliberately skipped (so coverage reads as intentional). Cite
`file:line` as clickable references. Don't restate the diff back to the user.

If reviewing a PR and the user passes `--comment`, post the findings as a PR
review via `gh` **only after** showing them and getting the user's go-ahead.

### Worked example (match this shape)

> 🔴 **`api/upload.py:42` — unbounded read of the request body lets a client
> exhaust worker memory.** *(confidence 90, reliability)*
> **Failure scenario:** a request with a 2 GB body (or `Content-Length` lie)
> is `await request.body()`'d whole into RAM; a few concurrent requests OOM the
> worker and take down all conversions on that instance.
> **Fix:** stream to a temp file with a hard size cap (reject > `max_file_size`
> mid-stream), or enforce the limit at the proxy before the handler runs.
