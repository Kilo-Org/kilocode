# JetBrains ↔ VS Code Settings Parity: Easy Wins

## How parity works here

Both clients edit the **same shared `kilo.json`** through the CLI. So any setting whose
behavior lives entirely in the CLI is an "easy win" for JetBrains: the CLI already does the
work, JetBrains just needs a UI row that writes the config key. No CLI changes, no new feature.

Structural gap: today JetBrains only has **Models / Providers / Agent Behavior / Profile**
settings pages. There is **no General / Display / Experimental / Context / Checkpoints** page.
The lift for most easy wins is:

1. Add a new `Configurable` page (using existing `settings/base/` primitives —
   `BaseSettingsUi`, `SettingsRow`, `SettingsToggle`, `SettingsListPanel`), register it in
   `kilo.jetbrains.frontend.xml`.
2. Extend the `buildConfigPatch` allowlist in `KiloCliDataParser.kt` (currently only
   `model`, `small_model`, `subagent_model`, `subagent_variant`, `default_agent`) and add
   boolean/number JSON serialization — it currently only emits strings.
3. Add localized labels to `KiloBundle.properties`.

No CLI/SDK change and no new runtime feature.

## Excluded from "easy"

| Excluded | Reason |
|---|---|
| Agent Behavior, Auto-Approve | Skipped by request |
| Indexing, Sandboxing | Imply enabling new features |
| Browser Automation | Playwright feature not present in JetBrains |
| Autocomplete (provider/model/toggles) | No autocomplete feature (flags exist only as migration stubs) |
| Agent Manager (auto-branch, prefix) | VS Code-only feature |
| Notification/attention sounds | Client must implement sound playback |
| `maxCost` alert | Client must render the alert UI |
| Commit message (`commit_message.prompt`, `languageCommitMessage`) | No commit-message generation feature in JetBrains |
| `language`, `fontSize`, `diff.renderMarkdown`, `agentWorkStyle` | VS Code-webview/onboarding-specific |

## Tier 1 — Genuinely easy (CLI does all the work; just add UI + config key)

| Setting | Config key | Type | Suggested page |
|---|---|---|---|
| Hide prompt-training models | `hide_prompt_training_models` | bool | Models |
| Enable checkpoints | `snapshot` | bool | new "Checkpoints" |
| Auto-compaction | `compaction.auto` | bool | new "Context" |
| Compaction threshold % | `compaction.threshold_percent` | number | Context |
| Prune on compaction | `compaction.prune` | bool | Context |
| Watcher ignore patterns | `watcher.ignore` | string[] | Context (list editor) |
| Display username | `username` | string | new "Display/General" |
| Share mode | `share` | enum (manual/auto/disabled) | new "Experimental" |
| Remote control on startup | `remote_control` | bool | Experimental |
| Formatter integration | `formatter` | bool | Experimental |
| LSP integration | `lsp` | bool | Experimental |
| Batch tool | `experimental.batch_tool` | bool | Experimental |
| Native notebook tools | `experimental.native_notebook_tools` | bool | Experimental |
| Continue loop on deny | `experimental.continue_loop_on_deny` | bool | Experimental |
| SWE pruner (+ model) | `experimental.swe_pruner`, `..._model` | bool + string | Experimental |
| MCP timeout | `experimental.mcp_timeout` | number | Experimental |
| Per-tool toggles | `tools.<name>` | bool | Experimental |

**Claude Code compatibility**: lives under "Agent Behavior" in VS Code, but in JetBrains the
entire backend (`KiloClaudeCompatSettings` + RPC getter/setter + spawn-env wiring) already
exists with no UI. Exposing it is the single lowest-effort item — just a checkbox bound to the
existing RPC, no config plumbing.

⚠️ Hold back `experimental.codebase_search` (leans on indexing) and
`experimental.image_generation` (adds a tool) — arguably "enabling a feature."

## Tier 2 — Config is easy, but honoring it needs JetBrains rendering work

| Setting | Config key | Extra work |
|---|---|---|
| Auto-collapse reasoning | `auto_collapse_reasoning` | Reasoning-card default collapse |
| Terminal command display | `terminal_command_display` (expanded/collapsed) | Tool-card default state |
| Code edit display | `code_edit_display` (expanded/collapsed) | Edit-card default state |

## Recommendation

Add a new **"General/Display" page + "Experimental" page** driven entirely by CLI config,
seeded with Tier 1 behavioral settings, plus wire the already-built **Claude Code compat**
toggle. This closes most of the non-feature gap with:

- zero CLI/SDK changes,
- one allowlist extension in `KiloCliDataParser.buildConfigPatch` (add keys + boolean/number serialization),
- reuse of existing `settings/base/` UI primitives and test patterns (`FakeAppRpcApi`
  frontend test + `MockCliServer` backend body assertion).

Do Tier 2 (reasoning/terminal/edit display defaults) after Tier 1, since it touches the
session-rendering layer rather than being pure config.
