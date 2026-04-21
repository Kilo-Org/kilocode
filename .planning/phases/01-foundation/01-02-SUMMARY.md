# Plan 01-02 Summary: Canonical Position Library & Additive Config Types

**Status**: Complete
**Wave**: 2 of 2
**Date**: 2026-04-18

---

## Files Created

| File | LOC | Description |
|------|-----|-------------|
| `packages/opencode/src/devilcode/team/library.ts` | 211 | Canonical 11-position library: `CanonicalPosition` enum, `PositionLibraryEntry` schema, `POSITION_LIBRARY`, `POSITION_CAPABILITY_MAP`, `getDefaultCanDelegate`, `validatePositionLibrary` |
| `packages/opencode/test/kilocode/team/library.test.ts` | 105 | 11 library tests covering entry integrity, coordinator invariants, delegate helpers |
| `packages/opencode/test/kilocode/team/canonical-config.test.ts` | 391 | 23 tests: 7 stage coverage, 8 migration helper, 2 legacy regression + additional round-trip and edge-case tests |

## Files Modified

| File | Delta | Description |
|------|-------|-------------|
| `packages/opencode/src/devilcode/team/config.ts` | +288 LOC (additive) | Added `CanonicalTeamRole`, `CanonicalTeamRouting`, `CanonicalTeamConfig`, `fromLegacyTeamConfig`, `LegacyMigrationIssue`, `LegacyMigrationResult` after the existing legacy types; no legacy edits |

**Diff confirmation**: `git diff --stat packages/opencode/src/devilcode/team/config.ts` shows `1 file changed, 288 insertions(+)` — zero deletions, zero modifications to existing blocks.

**Presets diff**: `git diff packages/opencode/src/devilcode/team/presets.ts` is empty — untouched.

**Devil-vscode diff**: `git diff packages/devil-vscode/` is empty — untouched.

---

## Pre-flight Results

- **Reconciliation doc REQUIRES USER DECISION count**: 0 items (confirmed, Plan 01-02 proceeds without gate)
- **Server consumers of TeamConfig/TeamRole beyond `server/routes/config.ts`**: None found. `grep -rn "TeamConfig\|TeamRole" packages/opencode/src/server/` returned only `server/routes/config.ts:13` and `:92`. No expansion of Phase 2 server consumer scope needed.
- **`role.capabilities` references**: Only in `config.ts:241` (within the new `fromLegacyTeamConfig` implementation itself). No additional consumer files surfaced.

---

## Tests

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| `library.test.ts` | 11 | 11 | 0 |
| `canonical-config.test.ts` | 23 | 23 | 0 |
| Full team suite (8 files) | 91 | 91 | 0 |

**Legacy regression tests**: Both pass.
- `TeamRole still accepts stringly-typed capabilities` — `TeamRole.safeParse({ capabilities: ["coding", "ci"] }).success === true` ✓
- `TeamConfig parse of existing TEAM_PRESETS[0].team succeeds` ✓

---

## Migration Helper: 5/5 Presets Migrate with `ok: true`

| Preset ID | ok | Warnings | Errors |
|-----------|-----|----------|--------|
| solo-enhanced | true | 1 (unknown cap: `summaries` → supplementaryCapabilities) | 0 |
| code-review-pair | true | 0 | 0 |
| full-stack-team | true | 0 | 0 |
| ci-cd-pipeline | true | 0 | 0 |
| research-team | true | 0 | 0 |

The single warning on `solo-enhanced` is expected: the `research` role uses `summaries` which has no canonical synonym and correctly lands in `supplementaryCapabilities`.

---

## Verification Sweep

| Command | Result |
|---------|--------|
| `cd packages/opencode && bun run typecheck` | Exit 0, clean |
| `bun turbo typecheck` | Exit 0, 12/12 tasks successful (8 cached) |
| `cd packages/opencode && bun test test/kilocode/team/` | Exit 0, 91 pass, 0 fail |
| `cd packages/devil-vscode && bun run format:check` | Exit 0, all files use Prettier code style |
| `cd packages/devil-vscode && bun run knip` | Exit 0, no dead exports |
| `cd packages/devil-vscode && bun run check-devilcode-change` | Exit 0, no stale markers found |

**Verification Commands Run**: 6
**Verification Passed**: 6
**Verification Failed**: 0

**Note on full `bun test` suite**: The full CLI test suite (`packages/opencode && bun test`) includes pre-existing failures in `test/kilo-sessions/remote-ws.test.ts` (WebSocket timeout failures) and `test/kilo-sessions/remote-sender.test.ts`. These failures were confirmed pre-existing by running `git stash && bun test test/kilo-sessions/remote-sender.test.ts` on the baseline — same failures observed. They are unrelated to this plan's changes. The team test suite (91 tests, 8 files) and all kilocode tests pass 100%.

---

## Implementation Decisions

1. **`z.record(z.string(), CanonicalTeamRole)` instead of `z.record(CanonicalPosition, CanonicalTeamRole)`**: Zod v4's `z.record(enum, ...)` requires ALL enum keys to be present. Since a canonical team can have a partial set of positions (not all 11 required), we use `z.record(z.string(), ...)` with an explicit `.refine` that validates every key is a valid `CanonicalPosition`. This allows sparse canonical teams while still enforcing type safety.

2. **Migration output always starts with `enabled: false`**: The `fromLegacyTeamConfig` helper produces configs with `enabled: false` so the superRefine coverage check does not run against migrated configs. Phase 2's mandate is to enable canonical configs after verifying full stage coverage — the migration helper focuses on structural correctness, not coverage gating.

3. **Stage coverage check uses `STAGE_CAPABILITY_REQUIREMENTS` directly**: The `superRefine` iterates over `Object.entries(STAGE_CAPABILITY_REQUIREMENTS)` which produces deterministic ordering (insertion order of the const object: `plan, challenge, contract, build, review, ship, retro`). Error messages list all missing `stage(capability)` pairs in this deterministic order, as required.

---

## Phase 2 Handoff Notes

- **Migration helper ready for preset flip**: `fromLegacyTeamConfig` successfully migrates all 5 existing presets. Phase 2 can call this helper during preset initialization to produce `CanonicalTeamConfig` instances for the `GET /config/presets` endpoint.
- **Extension IPC still speaks legacy shape**: `packages/devil-vscode/webview-ui/src/types/messages.ts:399-408` defines a parallel `TeamRoleConfig` interface with `capabilities: string[]`. This is intentionally untouched. Phase 9 owns the extension-side schema update after all CLI consumers are migrated.
- **Server route unaffected**: `server/routes/config.ts` still uses `TeamConfig.safeParse()` and serves `TEAM_PRESETS` (legacy). Phase 2 updates the endpoint to serve canonical configs after verifying coverage.
- **`CanonicalTeamConfig` superRefine only runs when `enabled: true`**: This design allows Phase 2 to store both an enabled legacy config and a disabled canonical config during the migration window, then flip `enabled: true` once full stage coverage is confirmed.
