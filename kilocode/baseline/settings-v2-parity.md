# Kilo settings management on v2: parity audit

Evidence for the Kilo settings adapter in `packages/kilo-cli/src/settings.ts`,
its public contract in `src/settings-rpc.ts`, and its TUI surface in
`src/tui-plugin/settings.tsx`. Compares Kilo `origin/main` (v1) against this v2
tree. Source comparison: Kilo `origin/main` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`, current v2 HEAD
`59b29de40966803e2c7cd734d439843fb773f6a6` (not the historical pin alone).
Nothing is inferred from v1 documentation alone.

## v1 has no settings command

| Surface | What it is | Where |
|---|---|---|
| CLI | `config check` only — no read, write, or scope commands | `packages/opencode/src/cli/cmd/config.ts` |
| Docs | CLI settings are hand-edited JSONC | `packages/kilo-docs/pages/getting-started/settings/index.md`, CLI tab |
| HTTP | `GET /config/overlay|sources|effective|rules|model-state`, `PATCH /config/overlay` with `{scope: global\|project, set, unset, expected:{path,revision}}` | `src/kilocode/server/httpapi/groups/config-console.ts` |
| Scope model | scopes `global\|project`; targets `kilo.jsonc\|kilo.json\|opencode.jsonc\|opencode.json` plus `.kilocode\|.kilo`; revision hash; writability; fixed `fieldPaths` | `src/kilocode/config/overlay.ts` |
| Writer | jsonc-parser `modify`/`applyEdits`, whole-document validation, `target-changed`/`revision-conflict`/`target-not-writable`, mode 0600 for new global files | `src/kilocode/config/writer.ts` |
| Clients | VS Code (`client.config.overlayUpdate`) and the v1 TUI indexing dialog (Global/Project picker, indexing fields only) | `packages/kilo-vscode/src/KiloProvider.ts`, `src/kilocode/components/dialog-indexing.tsx` |

The v1 TUI indexing dialog is the only precedent for a scoped settings dialog,
and it manages Kilo indexing keys that do not exist on v2.

## v2 configuration is read-only end to end

| Surface | State at this baseline | Where |
|---|---|---|
| Protocol | `GET /api/config` returning `Config.Entry[]`; no write, no scope, no revision | `packages/protocol/src/groups/config.ts` |
| Filesystem API | read, list, find only | `packages/protocol/src/groups/fs.ts` |
| Core service | `Config.Interface` is `entries()` + `changes()`; no update | `packages/core/src/config.ts:35` |
| Precedence | `Config.latest` takes the last document defining a top-level key | `packages/core/src/config.ts:30` |
| Accumulating keys | `permissions` concatenate, `agents` merge per key across documents | `packages/core/src/config/plugin/agent.ts:87` |
| Native `/settings` | `opencode.settings` opens `DialogConfig`, presentation only (theme, animations, sidebar, scroll, attention, mouse) | `packages/tui/src/app.tsx:929`, `packages/tui/src/component/dialog-config.tsx` |
| v1 field mapping | owned upstream by `ConfigMigrateV1.migrate`, already consumed by the Kilo v1 import | `packages/core/src/v1/config/migrate.ts`, `packages/kilo-cli/src/import-v1-config.ts` |

Consequences: a Kilo settings surface cannot reuse a native write path because
none exists, and it does not shadow native `/settings`, which touches no
`Config.Info` field.

## Scope model deltas

| v1 | v2 in this host | Adapter behavior |
|---|---|---|
| `scope: "global"` | the global config directory is disabled (`Config.configured({ global: false })`) and the profile file is passed as the explicit config source | scope is named `profile`, targeting `layout.config` supplied by the host |
| project scope always active | project documents are opt-in (`ProjectConfig.configured({ enabled })`, `--project-config`) | the project scope reports `writable: false` with the opt-in reason and refuses writes |
| project target = first existing candidate | the host loads every eligible project document, and `.kilocode/kilo.jsonc` outranks `.kilo/kilo.jsonc`, which outranks a root `kilo.jsonc`, which outranks `kilo.json` | project values fold every document `ProjectConfig.readProjectEntries` returns; the write target is the highest-priority loaded document, or `.kilo/kilo.jsonc` when none exists |
| revision-based conflict detection | Kilo-owned optimistic edit token | TUI passes the snapshot's path and SHA-256 revision; a changed target/content is refused before applying the edit. |

Sources: `packages/kilo-cli/src/host.ts:22`, `src/paths.ts`,
`src/project-config.ts`, `packages/core/src/config.ts:186`,
`packages/kilo-cli/test/project-config.test.ts` ("legacy directory wins").

## Managed fields

Native `Config.Info` fields with a verified consumer at this baseline are
offered, plus one Kilo-only key whose value the host decode drops. Each row
names that consumer.

| Field | Type written | Consumer |
|---|---|---|
| `model` | `"provider/model"`, `"provider/model#variant"`, or the explicit object | `packages/core/src/config/plugin/provider.ts:42` |
| `default_agent` | non-empty string | `packages/core/src/config/plugin/agent.ts:91` |
| `shell` | non-empty string | `packages/core/src/config/plugin/shell.ts:16` |
| `snapshots` | boolean | `packages/core/src/config/plugin/snapshot.ts:16` |
| `websearch` | `false` or `{ provider }` | `packages/core/src/config/plugin/websearch.ts:14` |
| `warming` | boolean (a stored object form is preserved, not editable here) | `packages/core/src/plugin/warming.ts:19` |
| `compaction.auto` | boolean | `packages/core/src/config/plugin/compaction.ts` configures native automatic compaction |
| `compaction.buffer` | non-negative integer, tokens (not a percentage) | same plugin; `session/compaction.ts` subtracts the buffer from model input/context limits |
| `compaction.keep.tokens` | non-negative integer, including zero | same plugin; `session/compaction.ts` selects the retained recent-history tail |
| `tool_output.max_lines` | positive integer | `packages/core/src/config/plugin/tool-output.ts:16`, `packages/core/src/shell.ts:233` |
| `tool_output.max_bytes` | positive integer | same |
| `hide_prompt_training_models` (Kilo-only) | boolean | the Kilo model picker presentation in `packages/kilo-cli/src/model-picker.ts` reads it through this store; mirrors v1 `filterPromptTrainingModels` (`packages/opencode/src/kilocode/provider/model-filter.ts`) |

### Deliberately not managed

| Group | Fields | Why |
|---|---|---|
| Accumulating or secret-bearing collections | `agents`, `permissions`, `mcp`, `providers`, `commands`, `formatter`, `lsp`, `references`, `instructions`, `skills`, `plugins`, `experimental`, `media`, `watcher` | they merge or concatenate across documents rather than resolving last-wins, and provider or MCP entries can carry credentials |
| Parsed but unconsumed | `update`, `share`, `username`, `enterprise` | no consumer exists outside `packages/core/src/v1/config/migrate.ts` and `packages/core/test/config/config.test.ts` at this baseline, so presenting them as working settings would be false |
| Metadata | `$schema` | not a user setting |

### v1 settings with no v2 field

`indexing.*`, `privacy_mode`, `auto_collapse_reasoning`,
`terminal_command_display`, and the `enabled_providers`/`disabled_providers`
lists have no v2 equivalent field. `hide_prompt_training_models` is the one
Kilo-only exception now surfaced above: the retained upstream v1 schema does not
declare it, so the adapter reads it raw (below) and the v1 importer carries it
verbatim. `ConfigMigrateV1` carries a subset under different names
(`autoupdate` to `update`, `snapshot` to `snapshots`, `small_model` to
`agents.title.model`, provider lists to `experimental.policies`). The adapter
never re-derives any of this: `SETTINGS_UNSUPPORTED_NOTE` points users at the
v1 import report, which runs the upstream engine over their own file.

### Kilo-only keys read raw

The native decode drops keys that `Config.Info` does not declare, so
`hide_prompt_training_models` is read from separately parsed raw documents
instead of the re-encoded ones. The same fold rules apply: every loaded project
document path contributes, lowest to highest priority, so an ancestor document
that is not the write target can still supply the key; a reset on the target
folds that ancestor contribution back in. A stored value that does not decode is
reported through a fixed `invalid` explanation on the field state — never as the
raw value, which could echo arbitrary file content. The v1 provider-level
`dataCollection: "deny"` that v1 also derives from this key
(`packages/opencode/src/kilocode/provider/provider.ts`, `patchKiloProviderPrivacy`
and the `kilo` custom loader) has no v2 equivalent yet: this surface is a
presentation filter, not a data-collection guarantee.

## Write and read semantics

- Values reported per scope are the canonical values the host resolves: the same
  substitute, jsonc parse, normalize, decode pipeline the host applies
  (`packages/core/src/config.ts:96`), re-encoded to JSON. A literal
  `"anthropic/claude"` therefore reads back as `{ providerID, model }`.
- Kilo-only keys are the documented exception: they are read from raw parsed
  documents (no substitution, no Info decode) and are reported as stored. A
  stored value that does not decode yields a fixed `invalid` explanation instead
  of the arbitrary value; a wrong-typed write is refused with a content-free
  message.
- An invalid field is dropped by `ConfigNormalize` exactly as the host drops it,
  so a bad value is reported as unset rather than as configuration.
- A malformed document is reported with a reason and is never rewritten from a
  partial parse.
- Writes use jsonc `modify`/`applyEdits`, so comments and unrelated keys survive.
  A value must decode with its native field schema, and a document that decoded
  before the edit must still decode after it. Schema failures never surface,
  because they can echo decoded input.
- Writes are atomic (`wx` temp file, `chmod`, `rename`), preserve an existing
  file mode, and create new documents `0600` rather than depending on the umask.
  Profile writes re-run `preflight` before the rename.
- A failed profile preflight stops every read of that path instead of reporting
  the contents of a protected or symlinked file.
- Edits share the isolated profile's in-process queue with other settings
  Locations and `/privacy`. Concurrent RPCs cannot overwrite each other's keys,
  and a rejected edit cannot poison later edits. A real two-store plus privacy
  concurrent-write regression test verifies this; external editor conflicts
  still have the separate limitation below.

## Limitations

- The dialog now carries `expected: {path, revision}` (null for a missing
  target). Content changes, first-write collisions, and a changed project target
  are refused with a reopen message. This is an optimistic stale-dialog check,
  not a cross-process filesystem transaction; an external write after the
  check can still race the rename. Direct callers that omit the optional token
  retain the previous immediate-edit behavior.
- Resolution covers the two managed scopes only. Values from sources outside them
  (well-known or managed manifests, `OPENCODE_CONFIG_CONTENT`) are not represented.
- Reset edits only the write target. A lower-priority project document may still
  contribute the key afterwards, which the snapshot then reports honestly.
- Compaction is a verified leaf-wise exception to the collection limitation:
  the native plugin applies each defined `auto`, `buffer`, and `keep.tokens`
  leaf in document order. The dialog uses these existing v2 meanings, without
  converting v1 percentage thresholds or claiming v1 prune-policy equivalence.
- Loaded configuration changes take effect on host restart: the preview disables
  config file watching (`packages/kilo-cli/src/host.ts:18`), and the only other
  reload triggers are credential switches, well-known updates, and a ten-minute
  refresh (`packages/core/src/config.ts:236`). `restartRequired` carries this to
  the UI.
- Collection editing (agents, permissions, MCP, providers) is out of scope, so
  the v1 VS Code settings panels have no equivalent here.

## Wiring

The host owns registration. `createSettingsPlugin({ layout, project })` registers
the RPC in `interactive-server.ts`; `installSettingsUi(ctx, { client, signal })`
adds `/kilo-settings` in the TUI plugin. The UI imports only `settings-rpc.ts`,
never the filesystem implementation.

## Verification

Run from `packages/kilo-cli` with the packaged Bun 1.4 runtime
(`dist/interactive/bun`):

| Command | Covers |
|---|---|
| `bun typecheck` | the settings modules, the picker, and their test files |
| `bun test test/settings.test.ts` | scope reporting, opt-in refusal, comment and mode preservation, project folding across ancestor documents (including the Kilo-only key), reset fallback, schema refusals, queue recovery, preflight and boundary refusals, no secret echo |
| `bun test test/model-picker.test.ts` | group/category derivation, `mayTrainOnYourPrompts === true` hiding only for real metadata (unknown and other providers stay visible), effective project-over-profile preference read live per open, abort and error propagation |
| `bun test test/import-v1-config.test.ts` | v1 config mapping reports, and the Kilo-only boolean import: carried for true/false, read back raw by the settings store, wrong type refused content-free |
| `bun test --preload @opentui/solid/preload test/settings-ui.test.tsx` | real host plus real TUI: the host loads values written through the adapter, `/kilo-settings` drives prompt, choice, and reset edits over the public RPC (including the Kilo-only toggle), an unwritable scope explains itself, and no session is admitted |
| `bun test --preload @opentui/solid/preload test/model-picker-ui.test.tsx` | real host, gateway, and TUI: Auto/Recommended grouping, favorite persistence, and the hide preference read live — enabling it removes the flagged model from every dialog section while the favorite persists, and resetting shows it again |

The model picker's hide behavior is presentation policy only: it filters
listings served by the picker, and never guarantees which models the Gateway
serves or what the provider does with prompts.

### Settings UI fixture readiness follow-up (2026-09-05)

The earlier intermittent UI failure selected the first unfiltered option:
merely finding the target's text in a frame did not prove focus, processed
filter input, or selected-row state. The fixture now waits for the native
editor type, its input text and the selected option's rendered bold span
before sending Enter. Toast assertions also allow line wrapping. No production
dialog behavior was changed.

The delegate recorded three consecutive isolated settings UI passes. Root
independently reran settings UI plus both memory-sidebar targets with bundled
Bun 1.4: **5 pass / 0 fail**. This closes the focused fixture investigation,
not the pending coordinated full-suite validation or the remaining v1
`dataCollection: "deny"` provider-policy gap.
