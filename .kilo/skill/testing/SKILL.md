---
name: testing
description: Write and run bun tests for packages/opencode — fixtures, Instance.provide, resetDatabase, sanitization-test patterns, and the Windows teardown quirk.
---

# Testing in packages/opencode

## Run
- Single test: `bun test test/tool/remember.test.ts` (run from `packages/opencode/`)
- All tests: `bun test`
- Typecheck: `bun run typecheck` (uses `tsgo --noEmit`)

## Fixtures (do NOT hand-roll temp dirs)
```ts
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
```
- `await using tmp = await tmpdir({ git: true })` — creates a real temp dir, auto-cleaned when `tmp` leaves scope. Access via `tmp.path`.
- Code that touches project state must run inside `Instance.provide({ directory: tmp.path, fn: async () => { ... } })` so it binds the right `Instance.project`.
- Call `await resetDatabase()` in `afterEach` to avoid cross-test contamination.

## Patterns
- Avoid `mock` as much as possible; test the real implementation.
- Assert on stored/returned data, not internal state.
- Sanitization tests: build malicious input with REAL unicode via `String.fromCharCode` or `String.raw`:
  - BOM `U+FEFF`, WORD JOINER `U+2060`, RLO `U+202E`, ZWSP `U+200B`.
  - Assert BOTH that raw storage is byte-for-byte unchanged AND that rendered/prompt output is sanitized.

## Windows teardown quirk
`bun test` ends with a known `EACCES` error from `test/preload.ts` (SQLite WAL handles). This is NOT a test failure — judge by assertion counts, not the trailing error.

## Upstream hygiene
When editing shared `packages/opencode/src/**` files (anything NOT under `src/kilocode/`), keep changes minimal and mark them with `kilocode_change` comments. Files in `src/kilocode/` and any `kilocode`-named path are Kilo-specific and need no markers.
