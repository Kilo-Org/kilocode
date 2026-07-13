# Kilo Test Preservation Re-review: PR #12088

## Second-pass verdict

**Reviewed head:** `b42f911f7680559b536850aab414258d0eb59a88`

**Current `origin/main`:** `6639022345dd0966b6e028f2c7e533ab91e97166`

**Merge base:** `be15cf4b556bea96aaef6de1b3c405b86c0d1a6c`

Most first-pass preservation gaps are resolved, and Linux, macOS, and Windows unit jobs pass. One confirmed migration regression lacks coverage, and the smaller Bus/SSE race gap remains a follow-up.

## Finding

### High: restored JSON migration tests miss usage backfill and retry semantics

The broad Kilo-owned suite at `packages/opencode/test/kilocode/storage/json-migration.test.ts` restores JSON-era upgrade coverage and Windows-safe cleanup. It does not import assistant usage and assert session aggregates, and its bootstrap tests do not verify retry after a source read or batch insert failure.

Those omissions hide the confirmed production break documented in `BROKEN_PIPELINE_CHAINS.md`: schema usage backfill runs before JSON import, imported sessions are stored with zero totals, and partial imports commit a DB file that suppresses later bootstrap attempts. Add bootstrap-level tests for both behaviors.

## Remaining follow-up

`packages/opencode/test/kilocode/legacy-sse-event.test.ts` proves basic directory/workspace routing and one versioned sync envelope, but does not preserve burst delivery, simultaneous callback/SSE delivery, or both subscriber acquisition orders from the deleted diagnostics suites. Add a compact Kilo-owned race suite around the retained GlobalBus/legacy SSE boundary.

## Resolved first-pass findings

- **`repo_clone`:** the Kilo-owned live suite restores clone/reuse, refresh, branch, malformed/local URL, and invalid-branch cases. It is selected by Linux/Windows full suites and the Darwin profile.
- **Native watcher:** the core suite runs under Darwin CI through a Kilo wrapper and profile entry; create/change/delete, cleanup, Git filtering, HEAD, non-Git, and symlinked-Git cases remain.
- **`containsPath`:** focused Kilo-owned tests cover nested directory/worktree containment, escapes, prefix collisions, and the root-worktree guard.
- **Forced import cleanup:** the real-database test inserts message/part rows and verifies cascade cleanup after replacement.
- **JSON-era upgrade support:** projects, sessions, messages, parts, todos, shares, corruption/orphans, idempotency, and Windows DB/WAL/SHM cleanup are restored. The suite is broad but does not cover the newly identified aggregate/retry defects.

## CI verification and limitations

`gh pr checks 12088` reports passing Linux shards, macOS, four Windows shards, generated artifacts, typecheck, HttpApi exerciser, docs, and JetBrains checks. Exact-ref Darwin profile resolution includes both watcher and `repo_clone`. Native Darwin behavior and Windows locked-file cleanup were not reproduced on this Linux host; no local package test was run from the unrelated dirty worktree.
