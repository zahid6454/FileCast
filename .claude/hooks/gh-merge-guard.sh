#!/usr/bin/env bash
# PreToolUse guard: force a permission prompt before any `gh api` call that
# merges a PR. Matches the REST merge endpoint (.../pulls/<n>/merge) and the
# GraphQL mergePullRequest mutation. All other gh api calls pass through
# untouched (no output = neutral, normal permission flow continues).
in=$(cat)
if printf '%s' "$in" | grep -Eiq 'gh[[:space:]]+api' \
   && printf '%s' "$in" | grep -Eiq 'pulls/[^/"]+/merge|mergePullRequest'; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This gh api call targets a PR merge endpoint — confirm before merging."}}'
fi
