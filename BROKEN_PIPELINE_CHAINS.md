# Broken Pipeline Chains Re-review: PR #12088

## Second-pass verdict

**Reviewed head:** `b42f911f7680559b536850aab414258d0eb59a88`

**Current `origin/main`:** `6639022345dd0966b6e028f2c7e533ab91e97166`

**Merge base:** `be15cf4b556bea96aaef6de1b3c405b86c0d1a6c`

**Verdict: request changes.** The original session-diff blocker is fixed, but the restored JSON-to-SQLite bootstrap has a confirmed migration-order/completion break that loses historical usage aggregates and suppresses retries after partial imports.

## Finding

### High: JSON bootstrap records incomplete imports as complete and loses session usage

`packages/opencode/src/kilocode/storage/json-migration.ts:30-47` skips migration whenever the destination DB file exists. On first run it creates the DB through `Database.defaultLayer`, which executes and journals all schema migrations before importing JSON.

That ordering makes `20260510033149_session_usage` ineffective for imported data: its SQL backfills session cost and tokens from assistant messages while the new DB is empty. The importer later writes every session with literal zero usage at `json-migration.ts:254-273`, inserts messages separately, and never recomputes the aggregates. Persisted zero totals then reach the session API, TUI prompt cost, and statistics/token consumers.

The same bootstrap treats partial failure as success. JSON read failures and batch insert failures are collected in `stats.errors`; the transaction still commits at line 443 and errors are only logged. The newly created DB file then causes every later startup to skip migration, so valid records in a failed batch are not automatically retried even though source JSON remains on disk.

Import before the usage backfill or run a resumable post-import aggregate update. Do not use destination-file existence as the completion marker when source reads or inserts failed. Add bootstrap tests covering assistant usage totals and a failed first attempt followed by retry.

## Resolved first-pass finding

Session-wide diffs now work for callers that omit `messageID`. `packages/opencode/src/session/summary.ts:146-163` reads cumulative `session_diff/<sessionID>`, normalizes paths/large patches, and returns the stored value. `packages/opencode/test/server/session-diff-missing-patch.test.ts` covers the HTTP path used by VS Code and TUI.

## Follow-ups before native v2 adoption

- The core v2 config/agent/tool stack does not preserve Kilo sandbox policy, but `kilo serve` uses `createListenerRoutes()`, which omits `v2Routes`; first-party clients use legacy prompt endpoints. This is dormant, high-risk debt rather than a currently exposed sandbox bypass.
- EventV2 bridge envelopes cannot derive `project` from `Location.Ref`; native runner events would be filtered from experimental TUI v2 synchronization. The affected prompting route is likewise omitted from `kilo serve`, and the debug UI is flag-gated.
- `runSyncSafe` protects default legacy message/part writers but not native projector writes. Add native deletion-race handling before mounting v2 prompting or enabling event mirroring by default.

## Notable non-findings

- Kilo's `sandbox.allowed_hosts` chain is connected through the active v1 schema, VS Code settings, policy normalization, and adopted tool execution.
- The active first-party prompt chain remains on Kilo's sandbox-aware legacy runtime.
- Snapshot runtime, edit/write diff metadata, editor context, session platform attribution, and the repaired cumulative diff retain final consumers.

## Commands and limitations

The second pass traced exact-ref startup, database layers, migration registry, importer transactions, session API consumers, listener route assembly, generated SDK routes, EventV2 bridge/SSE/TUI filtering, sandbox policy, and native projector paths. Current platform unit and typecheck jobs pass, but existing JSON tests do not assert imported usage or retry after partial failure. No destructive migration reproduction was run.
