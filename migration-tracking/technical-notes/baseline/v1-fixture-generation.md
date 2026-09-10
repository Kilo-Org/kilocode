# Real V1 writer fixture and V2 migration audit

Audited on 2026-09-05. This is a disposable-fixture result, not a claim that
any real user store has been opened. The test creates a new V1 database under
`/tmp`, copies it to a separate disposable destination, and runs the V2
migration only against that copy. Those fixture directories are newly created
and clean; that does not describe the cleanliness of the source checkout.

## Exact source and runtime

The source checkout is `/Users/johnnyamancio/Workspace/kilo_workspace/kilocode`
at `d99662338e3ddbd2613ab41fc0369837a6eb4be9` (merge pull request #13046,
2026-08-10). It was already dirty and was not changed by this work. Its
porcelain status at audit time was:

```
 M .gitignore
 M bun.lock
 M packages/opencode/AGENTS.md
?? .agents/
?? .claude/
?? .kilo/agents/
?? .kilo/plans/1785871497799-backend-health-curl-script.md
?? .kilo/plans/1786293900000-tui-invisible-progress.md
?? .kilocode/skills/gh-stack
?? packages/plugin/plugin
?? packages/script/script
?? packages/sdk/js/sdk
?? packages/tui/test/cli/cmd/tui/repro-batch-drop.script.tsx
?? packages/tui/test/cli/cmd/tui/repro-filter-and-latch.script.tsx
?? packages/tui/test/kilocode/repro-opentui-streaming.script.ts
?? plans/architecture-risk-remediation.md
?? skills-lock.json
?? vscode-self-test.config.json
```

The fixture child loads the V1 checkout's own `effect` package
(`4.0.0-beta.83`) by absolute URL. The test process uses the packaged V2 Bun
runtime (`1.4.0`); the ambient system Bun in the V1 checkout is `1.3.14` and
is not used to run the fixture. The V2 worktree uses Effect `4.0.0-rc.112`.
No dependency was installed, and no network or model request is made.

The current source writer path is:

- `packages/opencode/src/session/session.ts`: `Session.create`,
  `updateMessage`, `updatePart`, and `setSummary`.
- `packages/core/src/event.ts`: durable publication validates event data with
  `Schema.encodeUnknownSync` before persistence.
- `packages/core/src/session/projector.ts`: the durable projectors write the
  V1 `session`, `message`, and `part` tables.

The child uses those writer methods, not direct SQL. It records a normal user
message, assistant message, completed `bash` tool part, Kilo step-finish part,
compaction marker plus summary assistant, and a session summary diff. The
recorded tool command is fixture data only; no shell is executed.

The checked-in dump is produced by `test/v1-writer-fixture-generate.ts` and
`sqlite3 .dump`. The generator replaces only the random disposable project
directory prefix with `/tmp/kilo-v1-writer-fixture-project` so the SQL artifact
does not contain a machine-specific temporary path; all writer-produced
session/message/part payloads remain otherwise unchanged.

Current artifact SHA-256:
`19dea6107a425ef902304454fec929ce8210edfa4b4a718c2287c551915c1f7c`.
Regeneration intentionally produces a new session/event id and wall-clock
values; the generator prints the replacement artifact hash for provenance.

## Ref drift checked before using the writer

The local objects also contain the refs recorded by the earlier audit:

- `1536aef0fbe96c4575d23e9de2d50ba897f6b8ac` (`release: v7.5.14`)
- `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7` (`origin/main`, merge after
  `1536aef`)

Both are descendants of the checked-out `d996623` for the relevant source.
The path-limited diff `d996623..1536aef` and `d996623..ecccd1f` is identical:
eight touched database/event/session files, 124 insertions and 15 deletions.
The changes add the Kilo board migration, `EventV2.publishAll`, fork-writer
and platform plumbing, the `revert.workspace` field, and SQLite/concurrency
ordering. They do not change the `Session.create`/message/part writer seam or
make `FileDiff` counts optional. The three checked refs all define
`FileDiff.Info.additions` and `.deletions` as `Schema.Finite`.

## Test result

Run from `packages/kilo-cli`:

```
dist/interactive/bun --no-env-file test --preload @opentui/solid/preload \
  --timeout 120000 test/v1-writer-fixture.test.ts
```

Result: **1 pass, 30 assertions**. This is the normal, dependency-free test;
it loads the checked-in generated dump and does not require the sibling V1
checkout.

The live writer roundtrip is intentionally explicit because it loads the
separate V1 dependency graph:

```
KILOCODE_V1_CHECKOUT=/Users/johnnyamancio/Workspace/kilo_workspace/kilocode \
  dist/interactive/bun --no-env-file test --preload @opentui/solid/preload \
  --timeout 180000 ./test/v1-writer-fixture-live.ts
```

Result at audit time: **1 pass, 35 assertions**. It requires
`KILOCODE_V1_CHECKOUT` and is not included by the default test discovery.

The test's isolated V1 writer produced:

| Source table | Rows | Evidence |
|---|---|---|
| `session` | 1 | actual `Session.create` plus `setSummary` |
| `message` | 4 | user, assistant, compaction user, summary assistant |
| `part` | 6 | user text, assistant text/tool/step-finish, compaction, summary text |

Before opening the source, the test hashes the database and WAL. It then uses
`copyV1Store` to make a no-clobber copy outside the source directory and checks
the copy report. After migration, it hashes the source content files again and
requires the hashes to be identical. The `-shm` index is intentionally not
hashed because a read-only SQLite reader may update its read marks.

The V2 `Database.layer` applies the real database migrations, and
`V1Migration.run()` runs against the copied database. The migration completes
and projects three `session_message` rows:

| V2 row | Result |
|---|---|
| user | text and creation timestamp preserved; V1 `editorContext`, `system`, and message `summary` are dropped by the V2 message shape |
| assistant | text, completed tool content, model, cost, and token counts preserved; `structured` is dropped and V1 `end_turn` normalizes to V2 `unknown` |
| compaction | compaction marker and summary assistant are folded into one completed compaction row; rendered recent text contains the earlier user text |

The session summary diff is copied with its file, patch, before/after content,
and `additions: 1`/`deletions: 0`. The source step-finish `model`,
`generationID`, `vercelID`, `metrics`, and active-generation `time` are
validated and present in the source part, but are not represented in the V2
assistant content. The source aggregate row has the step-finish usage (`cost
0.5`, token counts `2/3/4/5/6`), while the V2 migration recomputes aggregates
from both assistant messages (`cost 0.75`, input/output/reasoning/cache
`3/5/5/7/7`). This is an intentional observed transform, not a preservation
claim for per-step metrics.

The V1 event table is empty after migration by design; V2 rebuilds the
projected transcript from `message` and `part`. The summary assistant's source
row is not a separate V2 message because compaction pairing consumes it.

## FileDiff hard gate and remaining boundary

The earlier schema audit described a V1 optional-count `FileDiff` case. That
shape is not present in the exact source refs available here: the checked
writer's event publication rejects a missing `additions` or `deletions` before
it writes the event or `message` row. The fixture therefore uses only a
writer-valid diff and does not cast, hand-edit SQL, synthesize counts, or claim
to test the missing-count negative case. No local historical ref with an
optional-count `FileDiff.Info` was available without fetching or changing the
source checkout.

Consequently this test proves the valid-count path for this exact writer/ref;
it does not clear the general preservation gate for older or malformed V1
stores. A future negative fixture needs an exact historical writer/schema that
actually permits omitted counts, followed by an explicit assertion that V2
skips the invalid user message. It must not be manufactured through this
current writer.

Host storage ownership/sealing, auth/config import, and end-to-end boot of the
migrated copy remain outside this fixture slice.
