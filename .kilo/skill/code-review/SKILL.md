---
name: code-review
description: Checklist for reviewing diffs/commits in this fork — security, correctness, tests, upstream hygiene, kilocode_change markers. Use alongside the reviewer subagent.
---

# Code Review Checklist

## Must-pass
- No secrets or credential logs; no `console.log` of tokens.
- No new `any` without justification.
- Tests added/updated for behavior change; `bun test` green (ignore the known Windows `EACCES` teardown noise).
- `bun run typecheck` clean for changed files.

## Security
- Prompt-injection: never trust raw stored/user content in system prompts or tool outputs — sanitize at render (see `filesystem`/`testing` skills and `Memory.renderDisplay`).
- Validate external input; no `eval`/dynamic `require` of untrusted paths.

## Upstream hygiene
- Shared-file edits marked with `kilocode_change`; Kilo-specific code under `src/kilocode/`.
- Minimal diff from upstream; no gratuitous refactors.

## Output format
Report PASS/FAIL, RISKS, NEXT ACTION. For FAIL, cite file:line.
