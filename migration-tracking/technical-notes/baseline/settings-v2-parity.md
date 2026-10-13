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
| `media.image.auto_resize` | boolean | `packages/core/src/config/plugin/image.ts:18` feeds the `Image` service (`packages/core/src/image.ts:70`); an oversized image is resized when on and refused when off (`packages/core/src/image/photon.ts:48`) |
| `media.image.max_width` | positive integer | same consumer; bounds the resize and pass-through check |
| `media.image.max_height` | positive integer | same |
| `media.image.max_base64_bytes` | positive integer | same |
| `experimental.subagent_depth` | non-negative integer | `packages/core/src/tool/plugin/subagent.ts:129` (last-wins leaf; defaults to 1) |
| `experimental.portable_shell_scanner` | boolean | `packages/core/src/tool/plugin/shell.ts:123` (last-wins leaf; defaults to false) |
| `hide_prompt_training_models` (Kilo-only) | boolean | the Kilo model picker presentation in `packages/kilo-cli/src/model-picker.ts` reads it through this store; mirrors v1 `filterPromptTrainingModels` (`packages/opencode/src/kilocode/provider/model-filter.ts`) |

### Deliberately not managed

Reconciled against the current source on 2026-09-07: `media` and `experimental` were
previously listed here wholesale, but their scalar leaves have verified last-wins
consumers (`media.image.*` via the `Image` service, `experimental.subagent_depth` and
`experimental.portable_shell_scanner` via `Config.latest`), so they are now managed
leaf-wise like compaction. The remaining unmanaged groups:

| Group | Fields | Why |
|---|---|---|
| Accumulating or secret-bearing collections | `agents`, `permissions`, `mcp`, `providers`, `commands`, `formatter`, `lsp`, `references`, `instructions`, `skills`, `plugins`, `watcher` | they merge, concatenate, or accumulate across documents rather than resolving last-wins (`watcher.ignore` contributes per document at `packages/core/src/config/plugin/location-watcher.ts:17`), and provider or MCP entries can carry credentials; `experimental.policies` stays accumulating for the same reason |
| Parsed but unconsumed | `update`, `share`, `username`, `enterprise` | re-verified 2026-09-07: no consumer exists outside `packages/core/src/v1/config/migrate.ts` and `packages/core/test/config/config.test.ts`, so presenting them as working settings would be false |
| Metadata | `$schema` | not a user setting |

### Settings surfaces and v1 key migration are separate

The settings comparison follows current consumers and controls, including renamed
fields. It does not infer a missing capability from an absent v1 key name. The
separate `kilo.jsonc` import row remains open; a refusal is not an implemented
feature or a successful migration.

| V1 field or surface | Current control / consumer | Disposition |
|---|---|---|
| `auto_collapse_reasoning` | Native `/settings` Thinking and `/thinking` update `session.thinking` in the isolated `tui.json`; the session view consumes it | Reuse reasoning visibility. Hiding by default differs from collapsing after completion; do not claim literal semantics or cross-surface import parity. |
| `terminal_command_display` | Native `mini.shell_output` controls CLI shell output (`packages/tui/src/mini/footer.ts` and `footer.command.tsx`) | Related CLI presentation control, not an exact import mapping for the v1 VS Code expanded/collapsed field. VS Code remains phase 5. |
| `privacy_mode` | Kilo `/privacy` and the isolated privacy store | Existing Kilo control, carried by the importer; not a missing settings implementation. |
| `indexing.*` | Explicit `--indexing-config` input and `/indexing` status/control surface | Retain the existing opt-in adapter and its credential boundary. No silent migration or new general configuration field. |
| `enabled_providers` / `disabled_providers` | Native migration produces `experimental.policies`, consumed by `config/plugin/policy.ts` | Existing configuration behavior. The scalar settings dialog does not edit accumulating policies. |
| `hide_prompt_training_models` | `/kilo-settings`, picker filtering and Gateway request policy | Managed Kilo-only boolean; live filtering and provider data-collection request covered separately below. |
| `web_search` | Native `websearch` provider field | Managed v2 field; the v1 force-enable boolean is not silently reinterpreted as provider selection. |
| `remote_control` | Kilo `/remote` | Remote capability is tracked in its own open row; no v1 auto-start-key consumer is claimed. |
| `commit_message.prompt`, `code_edit_display`, `mcp_tool_display`, Console fields | No corresponding shipped v2 setting consumer | Leave their IDE/commit-generation/Console capability dispositions in the separate plan rows. Unsupported import remains explicit. |

`ConfigMigrateV1` carries recognized native keys under their native names (for
example `snapshot` → `snapshots`, `small_model` → `agents.title.model`). The
settings adapter does not invent a second migration engine.

### Community settings proposal comparison

The canonical plan records #12502 as an open proposal, with the decision to
reuse native controls and implement the scoped Kilo delta rather than transplant
its unified v1 dialog. This is a local source comparison, not a fresh remote PR
status check.

| Proposed workflow | Current behavior and boundary |
|---|---|
| Presentation controls | Native `/settings` and persistent isolated `tui.json`; no second presentation store |
| Global/project edits | Kilo Profile/Project picker, loaded-document precedence, optimistic revisions, atomic saves, reset fallback and opt-in refusal |
| Immediate save | RPC set/reset persists immediately; UI explicitly requires restart for host configuration to take effect |
| Provider connection management | Native integration dialog adds credentials and removes a selected credential; this is not a generic persistent provider enable/disable editor |
| Model choice | Native picker/favorites plus Kilo metadata/filtering; scoped default `model` is managed by `/kilo-settings` |
| Agent choice | Native `/agents` selects an agent; scoped `default_agent` is managed; it does not edit agent definitions |
| Plugin controls | Native dialog can toggle TUI plugin activation and inspect/update server packages. Host-owned plugin composition is fixed; `createTuiConfig` excludes plugin persistence. Do not claim arbitrary host plugin disable/re-enable persistence. |
| Permission/agent/provider/MCP collection editing | Outside the existing scalar adapter scope. Existing engines/configuration remain; the proposed unified collection editor is not implemented or claimed equivalent. |
| Kilo-specific fields | Managed training-model preference plus existing privacy, indexing, and native display controls described above |

### Kilo-only keys read raw

The native decode drops keys that `Config.Info` does not declare, so
`hide_prompt_training_models` is read from separately parsed raw documents
instead of the re-encoded ones. The same fold rules apply: every loaded project
document path contributes, lowest to highest priority, so an ancestor document
that is not the write target can still supply the key; a reset on the target
folds that ancestor contribution back in. A stored value that does not decode is
reported through a fixed `invalid` explanation on the field state — never as the
raw value, which could echo arbitrary file content. Within a scope's fold the
raw read distinguishes absent from `null`: only `undefined` is absent, while a
stored `null` is a value that fails the boolean decode and is reported invalid
like any other wrong type. An invalid scope then contributes nothing, so a
valid value in the other scope still wins — the invalid scope neither shadows
it nor invents a reset. (Native fields keep the store's existing nullish fold,
unchanged.)

The raw fold is also independent of native document acceptance. Native
config failures are almost entirely field-level — a wrong-typed field drops,
a missing `{env:...}` becomes empty — so a document survives them. The genuine
whole-document failures (a missing `{file:...}` reference fails substitution;
an unparseable or non-object file) skip the document for native fields, yet a
raw Kilo-only value in the same document still applies: the dialog shows it,
the picker honors it, and the request policy denies. This is deliberate,
checkpoint-accepted behavior, now measured by a regression test using a missing
`{file:...}` reference; the broken scope's reason says precisely that the host
ignores the document's native configuration while separately parsed Kilo-only
values may still apply. The host never honors the document's native
configuration in this state — no claim to the contrary is made anywhere.

The v1 provider-level `dataCollection: "deny"` that v1 also derives from this
key (`packages/opencode/src/kilocode/provider/provider.ts`,
`patchKiloProviderPrivacy` and the `kilo` custom loader) now has a v2
equivalent. The host bridges the same raw fold above to the Gateway plugin as
`GatewayOptions.dataCollectionPolicy` (`src/request-policy.ts`, wired in
`src/interactive-server.ts`), reusing this store and the picker's own effective
resolution (`hidePromptTrainingModels` in `src/settings-rpc.ts`): project wins
over profile, and only an explicit stored `true` resolves `deny`. False, unset,
or invalid values resolve nothing — an invalid scope does not shadow a valid
one, exactly as the snapshot's `values` report — so the wire never invents a
restriction. The plugin re-reads the policy on startup and on every account
refresh (credential events, `organization.set`, startup) plus `config.updated`,
keeps the last known value on a failed read, and applies it in the existing
`http.request` hook: `provider.data_collection: "deny"` is merged into every
serialized Gateway request body (`/messages`, `/chat/completions`, `/responses`)
with v1 `transformRequestBody` semantics — an existing record `provider` keeps
its routing fields, a missing or non-record one becomes exactly the marker.
Wire proof: the launched-host fixtures assert the marker on title, both native
Auto routes, and ordinary protocol bodies, and its absence while the setting is
unset. This is a deny *request* to the Gateway, not a guarantee that providers
honor it; the picker's hide behavior remains presentation policy only.

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
  The `media.image` leaves and the `experimental.subagent_depth` /
  `experimental.portable_shell_scanner` leaves share that fold shape: the host
  applies defined leaves across documents in order (last definition wins), so
  the dialog manages them leaf-wise too.
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
| `bun test test/settings.test.ts` | scope reporting, opt-in refusal, comment and mode preservation, project folding across ancestor documents (including the Kilo-only key), reset fallback, schema refusals, queue recovery, preflight and boundary refusals, no secret echo, Kilo-only null-as-invalid fold (sole/profile/ancestor, content-free notice), the missing-`{file:...}` measurement that a natively ignored document still supplies raw Kilo-only values, and the media/experimental leaf write-refuse-reset roundtrip (2026-09-07: 21 pass / 0 fail with the packaged Bun 1.4) |
| `bun test test/model-picker.test.ts` | group/category derivation, `mayTrainOnYourPrompts === true` hiding only for real metadata (unknown and other providers stay visible), effective project-over-profile preference read live per open, abort and error propagation |
| `bun test test/import-v1-config.test.ts` | v1 config mapping reports, and the Kilo-only boolean import: carried for true/false, read back raw by the settings store, wrong type refused content-free |
| `bun test test/request-policy.test.ts` | the Gateway policy bridge: explicit true/false, project-over-profile precedence, reset fall-through, invalid values resolving unset without shadowing a valid scope, stored null as invalid (sole, non-shadowing, no invention), the missing-`{file:...}` raw-independence pin, disabled project scope |
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
not the pending coordinated full-suite validation.

### Request policy follow-up (2026-09-05)

The remaining v1 `dataCollection: "deny"` provider-policy gap is closed as
described under "Kilo-only keys read raw": the host bridges the raw settings
fold to the Gateway plugin, which merges `provider.data_collection: "deny"`
into Gateway request bodies when — and only when — the effective stored value
is an explicit `true`. The settings field description now says so, still
without promising that providers honor the request. Direct plugin coverage
proves all three dialects, provider-routing preservation, the v1 non-record
replacement, byte-identical already-applied bodies, malformed-body passthrough,
and refresh keep-last-known; the launched-host fixtures prove the marker on
title, both native Auto routes, and ordinary bodies, and its absence while the
setting is unset.

Freshness differs deliberately between the two consumers. The model picker
reads the setting live per dialog open through the settings RPC, so a picker
opened after an edit reflects it immediately. The request policy is a cached
host value: the Gateway plugin re-reads it only on startup, on account refresh
(credential events, `organization.set`), and on `config.updated`, matching how
every other loaded config value behaves here — the preview's config file
watcher is off (`packages/kilo-cli/src/host.ts:18`), the snapshot's
`restartRequired` already tells the dialog user that loaded changes apply on
restart, and settings edits emit no event. An edit can therefore reach the wire
earlier than restart (the next account or config refresh re-reads the raw
documents), but never later than the documented restart boundary, and it is
never re-read per request.

Two inherited fold semantics were reviewed and closed explicitly. A stored
`null` for the Kilo-only key is invalid (reported with the fixed content-free
notice), not absent; an invalid scope contributes nothing and a valid value in
the other scope still wins — no reset is invented. And the raw fold's
independence from native document acceptance applies to the wire too: a profile
document the host ignores natively (measured with a missing `{file:...}`
reference) still supplies an explicit Kilo-only `true`, so the deny marker
applies while the dialog reports the broken scope in the same snapshot. Both
behaviors are pinned in `test/settings.test.ts` and `test/request-policy.test.ts`.

### Managed-field reconciliation — 2026-09-07

The managed-field list was re-derived from the current source instead of the
2026-09-05 audit. Every `Config.Info` leaf with a verified runtime consumer is
now offered: the new rows are the `media.image` leaves (consumer
`config/plugin/image.ts`, leaf-wise like compaction) and the last-wins
`experimental.subagent_depth` / `experimental.portable_shell_scanner` leaves
(`tool/plugin/subagent.ts:129`, `tool/plugin/shell.ts:123`). The previous
classification of `media` and `experimental` as wholesale accumulating groups
was wrong for their scalar leaves and is corrected above; `experimental.policies`
and `watcher.ignore` remain accumulating and unmanaged. `update`, `share`,
`username`, and `enterprise` were re-verified as unconsumed at this source
(share is declared in `packages/schema/src/config.ts:40` but no runtime reader
exists; the share feature row is separately in progress).

The v1-only fields with no v2 consumer were re-checked key by key and keep
their refusals: `sandbox`-family keys configure the host only through the
`--sandbox` launch flag with host-typed options (`packages/kilo-cli/src/commands.ts:164`,
`interactive-server.ts:153`), telemetry consent is deliberately a separate
owner-only opt-in file (`packages/kilo-cli/src/telemetry-settings.ts`) that
shared upstream config must not express, and no consumer exists for
`remote_control`, `commit_message`, the console and
display keys, the subagent-model keys, or `web_search`'s force-enable boolean.
The importer already reports every such key through the generic drop probe.

Correction: `auto_collapse_reasoning` does have a native presentation equivalent:
TUI `session.thinking` is consumed by the session view and exposed through
`/settings` and `/thinking`. It is not a missing control. Import remains refused
because profile-to-`tui.json` migration is a separate configuration surface and
v2 default hiding is not identical to v1 collapsing after completion.

### Goal-62 validation — 2026-09-07

The real settings UI fixture now runs with project configuration both disabled
and enabled. The profile scenario retains the opt-in refusal. The project
scenario selects Project in the real dialog, edits the new image-width field,
resets it to expose the untouched profile fallback, then writes a project
override again. After the TUI and host scopes close, a second isolated host on
the same layout loads profile `1024` followed by project `768`; the public RPC
reports the project source. Both boots have zero admitted sessions. Fixture
entry validates containment before any settings writes.

Parent validation with packaged Bun 1.4: settings UI **2 pass / 0 fail**;
settings, request-policy, model-picker and TUI-config contracts **38 pass / 0
fail, 208 assertions**; package `bun typecheck` clean. No production code was
changed for this acceptance check, so the existing portable build is unchanged.
This evidence does not itself close the separate import, IDE or remote rows.

### Whole-row acceptance — 2026-09-07

The parent accepts the Settings scopes row after the scoped comparison above,
the two real-TUI scenarios, the focused contracts and independent review.
This raises the canonical inventory from 26/43 to **27/43 (62.8%)**.

The review's disposition conditions are resolved within the existing plan:
use native presentation controls without claiming exact v1 semantics; leave
cross-surface migration in the separate open import row; retain unsupported
IDE-only settings with their phase-5 capabilities; keep collection editing
outside this scalar adapter, as already specified. This does not declare the
open community proposal fully implemented, add migration credit for refusals,
or close another capability row.
