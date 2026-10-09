# V1 to v2 config mapping gap audit

Companion to `kilocode/baseline/pinned-v2-baseline.md` and
`kilocode/baseline/credential-import-v2-parity.md`. Audits every Kilo-only v1
config key at the pinned v1 source against the v2 migration engine, the v2
config schema, and the v2 runtime consumers, and records what the v1 import
(`packages/kilo-cli/src/import-v1-config.ts`) does with each.

## Sources

| Source | Reference |
|---|---|
| v1 Kilo config schema | `origin/main` `ecccd1f54b` (`packages/core/src/v1/config/config.ts`, `packages/core/src/config/experimental.ts`, `packages/core/src/policy.ts`, `packages/core/src/catalog.ts`) |
| v1 retained schema (this tree) | `packages/core/src/v1/config/config.ts` |
| v1 migration engine (this tree) | `packages/core/src/v1/config/migrate.ts` |
| v2 target schema | `packages/schema/src/config.ts` and `packages/schema/src/config/*.ts` |
| v2 runtime consumption | `packages/core/src/config/normalize.ts`, `packages/core/src/config/plugin/*.ts`, `packages/core/src/catalog.ts` |
| Import implementation | `packages/kilo-cli/src/import-v1-config.ts` |
| Import tests | `packages/kilo-cli/test/import-v1-config.test.ts` |

The Kilo-only key list was derived by diffing the top-level fields of the v1
`ConfigV1.Info` schema at the pin against this tree's retained v1 schema, plus
the Kilo-only nested fields marked `kilocode_change` in the pinned file.

## What the native migration already carries (not duplicated)

`ConfigMigrateV1.migrate` in this tree already maps these v1 keys; the import
does not re-implement them:

- `autoshare: true` -> `share: "auto"` (and `share` verbatim)
- `tools` -> `permissions` rules (with `write`/`patch` -> `edit`, `task` ->
  `subagent`, `bash` -> `shell` renames); `permission` merges on top
- `compaction.auto`, `compaction.preserve_recent_tokens` -> `keep.tokens`,
  `compaction.reserved` -> `buffer`
- `experimental.mcp_timeout` -> `mcp.timeout` (catalog and execution)
- `enabled_providers` / `disabled_providers` -> generated
  `experimental.policies` (`provider.use` allow/deny statements)
- `experimental.subagent_depth`, `mode`/`agent` -> `agents`,
  `small_model` -> `agents.title.model`, `model`, `default_agent`, `$schema`,
  `shell`, `username`, `enterprise`, `snapshot` -> `snapshots`, `watcher`,
  `formatter`, `lsp`, `attachment` -> `media`, `tool_output`, `mcp`,
  `skills`, `command` -> `commands`, `instructions`,
  `references`/`reference`, `plugin` -> `plugins`, `provider` -> `providers`,
  `autoupdate` -> `update`

Kilo v1 `model` / `small_model` / `default_agent` are `NullOr(string)` where
the retained v1 schema only accepts strings; the import treats an explicit
`null` as "unset" and drops it before decoding instead of failing the file.

## Carried by the Kilo-owned import seam

These keys are validated at the raw level and patched into the written profile
config. They are intentionally not added to the shared upstream v1 schema or
the migration engine.

| v1 key | v2 target | Why the mapping is exact |
|---|---|---|
| `privacy_mode` | `privacy_mode` (verbatim boolean) | Consumed by the isolated CLI privacy store (`packages/kilo-cli/src/privacy-settings.ts`) under the same key |
| `hide_prompt_training_models` | `hide_prompt_training_models` (verbatim boolean) | Consumed by the CLI settings store and gateway model routing (`packages/kilo-cli/src/settings.ts`, `settings-rpc.ts`, `interactive-server.ts`) under the same key |
| `subagent_depth` (top-level) | `experimental.subagent_depth` | The pinned v1 runtime consumed only the top-level key (`origin/main` `packages/opencode/src/tool/task.ts:135`), and the pinned experimental struct has no such field; the upstream migration engine reads only `experimental.subagent_depth` (`migrate.ts:89`), so it silently dropped the top-level form. The import validates the top-level value through the retained v1 schema's identical `NonNegativeInt` range and patches it into `experimental.subagent_depth` with top-level precedence over any migrated experimental value. The v2 runtime consumes the leaf (`packages/core/src/tool/plugin/subagent.ts:129`, last-wins `Config.latest`, default 1), and the Kilo settings dialog manages the same leaf. A real isolated host loads the patched value through its config pipeline. |
| `experimental.policies` | `experimental.policies` | The pinned v1 policy shape (`ConfigExperimental.Policy` = `PolicyV2.Info` fields with `action` narrowed to `Catalog.PolicyActions`, exactly `["provider.use"]` at the pin) is field-for-field the v2 `ConfigPolicy.Info` (`{action: "provider.use", resource, effect: "allow"\|"deny"}`). The v2 runtime consumes it: `packages/core/src/config/plugin/policy.ts` removes denied providers from the catalog, and `normalize.ts` places authored policies after generated ones with last-match-wins evaluation. The import validates each statement against the v2 contract (excess properties rejected) and appends authored statements after the migration-generated ones, preserving that precedence. |

## Refused: Kilo-only keys with no safe v2 seam

Every remaining Kilo-only key is reported unsupported by the import (blocking
the import by default; `--allow-unmapped` imports the mapped subset). None of
these dispositions is a capability claim; they are gaps recorded here, not row
completions. "Not silently retired" means the key is refused loudly, matching
the no-swallow rule.

Reconciled against the current source on 2026-09-07: each refused key below was
re-searched for a v2 runtime consumer, and none has gained one. The sandbox
feature configures only through the `--sandbox` launch flag with host-typed
options (`packages/kilo-cli/src/commands.ts:164`,
`packages/kilo-cli/src/interactive-server.ts:153`), never through profile
config, so `sandbox`-family config keys still have nothing to map into.
Telemetry consent is deliberately a separate owner-only opt-in file
(`packages/kilo-cli/src/telemetry-settings.ts`), so the v1 default-true
`experimental.openTelemetry` cannot map without inventing consent. The
`experimental.subagent_depth` and `media.image` v2 fields are native (carried by
the migration or authored fresh), not v1 mappings, and are now surfaced through
the Kilo settings dialog (see `settings-v2-parity.md`).

| v1 key | Why no mapping is safe |
|---|---|
| `web_search` (boolean) | v1 `web_search === true` force-enables the WebSearchTool while the provider is chosen by the model provider and env keys (`packages/opencode/src/tool/registry.ts` at the pin); v1 `false` means "not force-enabled", so provider-native search can still apply. The v2 target `websearch` is a provider selection (`false \| {provider: "random" \| WebSearch.ID}`) consumed by `config/plugin/websearch.ts`, where `false` forces search off. Mapping `true` to `"random"` invents behavior; mapping `false` to `false` changes meaning. Neither direction is equivalent. |
| `subagent_model`, `subagent_variant`, `subagent_variant_overrides` | No v2 target. v2 has per-agent `model` selections only; there is no "default task-subagent model" concept (`packages/schema/src/config/agent.ts`). Mapping to a named agent such as `general` would invent an equivalent. |
| `indexing` | v2 consumes indexing configuration only through the explicit opt-in `--indexing-config` launch input (`packages/kilo-cli/src/indexing-input.ts`), never from profile config. Mapping it into the written config would store values no runtime reads. Not mapped per instruction. |
| `sandbox` and `experimental.sandbox` / `sandbox_restrict_network` / `sandbox_writable_paths` | No v2 config consumer exists. Refused loudly, not silently retired. |
| `remote_control` | No v2 target field or consumer. |
| `auto_collapse_reasoning` | Native TUI `session.thinking` (`show`/`hide`) is consumed by the session view and exposed by `/settings` and `/thinking`. Import remains refused: mapping a profile key into `tui.json` crosses configuration surfaces, and hiding by default differs from v1 collapsing after completion. |
| `console` (`context_sidebar_width`, `diff_style`) | No v2 target field or consumer (Kilo Console UI state). |
| `terminal_command_display`, `code_edit_display`, `mcp_tool_display` | No v2 target field or consumer (VS Code chat UI state). |
| `commit_message` | No v2 target field or consumer. |
| `compaction.threshold_percent` | Kilo-only v1 extension; no v2 field. |
| `compaction.tail_turns`, `compaction.prune` | The v2 normalize explicitly reports both as unsupported (`normalize.ts`); the migration emits `prune` only for the v2 schema to drop it. |
| `experimental.openTelemetry` (v1 default-true telemetry opt-out) | v2 normalize lists `openTelemetry` as unsupported experimental; there is no v2 target. The v1 decoding default (`true`) is not reproduced anywhere in v2, and inventing a telemetry mapping would be a behavior claim, not a config mapping. |
| `experimental.image_generation`, `image_generation_model`, `native_notebook_tools`, `task_model_selection`, `speech_to_text_model`, `shared_agent_board` | v2 normalize lists the shared ones as unsupported experimental; the rest have no v2 target field. |
| `experimental.disable_paste_summary`, `batch_tool`, `primary_tools`, `continue_loop_on_deny` | v2 normalize lists them as unsupported experimental. |
| `logLevel`, `server`, `layout` | v2 normalize lists them as unsupported top level with no v2 target field or consumer (`layout` is deprecated in v1 itself). Top-level `subagent_depth` was reconciled out of this row on 2026-09-07: it now maps to the consumed `experimental.subagent_depth` leaf (see the carried table). |

## Validation

All commands used the package-local bundled Bun 1.4.0
(`packages/kilo-cli/dist/interactive/bun`) with `--cwd packages/kilo-cli`:

| Check | Result |
|---|---|
| `bun test test/import-v1-config.test.ts` | 49 pass, 0 fail (216 assertions), including the 5 policy tests below and the 4 subagent_depth tests (plan/readback precedence, top-level-only, real-host config-pipeline load, range/type refusal); re-run 2026-09-07 with the packaged Bun 1.4 |
| `bun typecheck` (package `@kilocode/cli`) | clean on 2026-09-07, including the settings and importer modules (an earlier run failed only on another slice's untracked `src/tui-plugin/sidebar-pr.tsx`; that file now typechecks) |

New tests (all in `packages/kilo-cli/test/import-v1-config.test.ts`):

- carries authored v1 experimental policies into the migrated v2 config (plan
  shape plus on-disk readback of the isolated profile config)
- orders authored policies after generated provider policies so authored
  statements win (v1 `disabled_providers` + authored allow for the same
  resource lands deny-then-allow)
- refuses authored policies that do not match the v2 policy contract without
  echoing them (unknown action, unknown effect, missing field, excess field,
  non-array; fixed generic diagnostic)
- reports v1 `web_search` (both `true` and `false`) and the subagent model
  keys as unsupported instead of inventing mappings
- applies imported provider policies through the native v2 catalog: imports a
  v1 config declaring two providers plus a deny policy for one, launches the
  isolated profile server with `models: false`, and asserts through the public
  `provider.list` client API that the denied provider is absent and the other
  is present

Subagent-depth tests (2026-09-07): top-level value wins over a migrated
experimental value while authored policies and unrelated keys survive (plan and
readback); top-level-only input writes the patched leaf; a real isolated host
loads `experimental.subagent_depth` through its public `config.get` pipeline;
`-1`, `1.5`, `"2"`, and `null` are refused with the fixed content-free schema
diagnostic.

## Honest acceptance status

- The authored `experimental.policies` mapping is implemented, tested at the
  plan, readback, precedence, refusal, and native-consumer levels.
- The top-level `subagent_depth` mapping (2026-09-07) closes the one refused
  key that had a proven, consumer-verified v2 target: plan/readback with
  top-level-over-experimental precedence, real-host pipeline load, and
  range/type refusals. No shared upstream file changed.
- The previously accepted `privacy_mode` / `hide_prompt_training_models`
  behavior is unchanged; its tests still pass.
- All other Kilo-only keys remain gaps, reported as unsupported by the import.
  That is evidence of an honest refusal surface, not capability completion:
  the table above records each gap with its source-backed reason.
- 2026-09-07 reconciliation: no refused key gained a v2 consumer, so no new
  mapping was added. The settings-dialog surface, not the importer, gained the
  native `media.image` and `experimental` leaf controls; the two surfaces stay
  separate because the importer maps v1 keys while the dialog edits native v2
  fields.
