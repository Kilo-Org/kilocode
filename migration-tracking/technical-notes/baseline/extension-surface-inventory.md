# Extension-led product inventory audit

## Evidence and scope — 2026-09-05

This audit expands the acceptance checklist behind the existing
[43-row port inventory](../../plans/kilo-opencode-v2-issue-13750.md#inventory-kilo-orgkilocode).
It does not count newly discovered UI controls as completed capabilities.

- V1 source: local `origin/main` at `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`;
  `packages/kilo-vscode/package.json` declares version `7.5.14`. This is source
  provenance, not the version of the running Extension Development Host.
- V2 comparison: `HEAD 59b29de40966803e2c7cd734d439843fb773f6a6` plus the existing
  local Kilo implementation. No fetch, ref change, build or dependency install.
- A Kilo/Sol delegate (`thr_7bdux6wma9`) attempted desktop observation, but
  window sizing prevented reliable menu navigation. Those observations are
  provisional and do not satisfy the requested VS Code self-test method.
- After Johnny authorized setup, the delegate completed a framework-driven
  audit in a separate disposable session using the older v1 checkout
  `d99662338e3ddbd2613ab41fc0369837a6eb4be9`, manifest `7.4.20`, with existing
  artifacts (`--mode dev --build false`). Artifact-to-HEAD correspondence is
  unverified. Older-runtime absence is not current-v1 absence.
- No extension prompts, account/team edits, purchases, live API probes or
  user-data mutations are part of this audit. No live credentials may be
  imported into the fixture. Private transcript/account values are excluded.

Use four evidence labels: **source-present**, **UI-observed**,
**local-workflow-tested**, and **live-contract-verified**. These are different
claims, not interchangeable completion levels. A command declaration proves
discoverability in source, not that its handler or backend works.

## Source-discovered acceptance checklist

Paths below are relative to `packages/kilo-vscode/` at the V1 SHA above unless
explicitly identified as current v2 paths. These rows are **source-present**;
none gains workflow-completion credit from this scan.

| Surface and source | What the inventory must explicitly check | Existing owner / v2 treatment |
|---|---|---|
| Model picker: `webview-ui/src/components/shared/ModelSelector.tsx:272` | Favorites, Auto, Recommended, **Most Used**, provider groups, search and deduplication. Most Used derives from usage history; it is not native v2 Recents under another name. | Reopened Gateway row + CLI TUI remainder; preserve native favorites and inspect missing metadata/history seams. VS Code renderer stays Phase 5. |
| Model defaults: `webview-ui/src/components/settings/ModelsTab.tsx` | Default/small/subagent models, thinking variants and per-model variant overrides; specialized autocomplete and speech selections. | Settings scopes/Kilo fields; map each schema and precedence to v2 rather than copying v1 config keys. Specialized editor fields stay client-owned. |
| Agent behavior: `webview-ui/src/components/settings/AgentBehaviourTab.tsx` | Built-in/custom agent visibility, default selection, create/edit/import/remove controls, scope/provenance, MCP connection/auth/config, rule and skill sources. | Native agent/skill/MCP engines reusable; management UI and Kilo policy remain separate acceptance work from discovery. |
| Workflows: `webview-ui/src/components/settings/agent-behaviour/WorkflowsTab.tsx:17` | This UI edits `config.command` entries with model/variant selection. Audit custom commands, scoped overrides and dispatch. | Reuse native v2 commands/config; do not invent a second workflow engine from the tab title. Settings + CLI TUI remainder + VS Code settings. |
| Auto-approve: `webview-ui/src/components/settings/AutoApproveTab.tsx` | Permission rule editor and cost-limit control; distinguish persistent rules from per-run auto approval, agent ceilings, rejection and interruption behavior. | Native permission engine reuse; settings/VS Code UI parity remains open. Headless `--auto` does not complete these controls. |
| Context/memory: `webview-ui/src/components/settings/ContextTab.tsx` | Project memory status/storage inspection, separate automatic-save consent, compaction model/limit/pruning and watcher settings. | Existing memory implementation remains credited for its tested subset; sidebar and settings fields are additional UI work. Reuse native compaction; audit unmapped fields. |
| Checkpoints: `webview-ui/src/components/settings/CheckpointsTab.tsx` | Toggle maps to v1 `snapshot`; separately verify transcript/diff restore interactions, not merely this setting. | Reuse v2 snapshot engine; Task timeline/diff and settings rows own client semantics. No restoration test performed in this audit. |
| History/navigation: `webview-ui/src/components/history/HistoryView.tsx` and `chat/PromptRail.tsx` | Local/cloud/optional worktree history, cloud import, search and prompt navigation. | VS Code sidebar/editor tabs and Task timeline rows. Local v2 transfer and cloud-agent CLI completion do not prove unified cloud history/import. |
| Editor/terminal context: `package.json` command contributions | Add selection or terminal content to context; explain/fix/improve code; fix/explain/generate terminal command; generated commit message. | Code actions/enhance/commit-generation row and VS Code chat. Command names are not tested workflows; editor integration is not a mandatory CLI copy. |
| Autocomplete: `src/services/autocomplete/` and command contributions | Classic FIM, chat input completion, next-edit accept/jump/dismiss and associated settings/model choice. | Existing Inline autocomplete/FIM row remains unverified; these are distinct editor behaviors, not ordinary chat inference. |
| Agent Manager: `package.json` contributions and settings `AgentManagerTab` | Worktree/project selection, sessions/tabs, terminals, scripts, diff panel, base-branch update and PR actions. | Existing Agent Manager row, distinct from the completed Swarm board. Never run scripts, change branches or create worktrees merely to inventory controls. |
| Marketplace: `webview-ui/src/components/marketplace/MarketplaceView.tsx`, `src/services/marketplace/types.ts` | MCP, agent and skill catalog/install/remove surfaces, project/global scope and provenance/trust. | VS Code settings/sidebar and Kilo configuration UX; native plugin/skill loading is not marketplace-install parity. Installation remains untested and requires its own safe fixture. |
| Web tools: `webview-ui/src/components/settings/BrowserTab.tsx` | Web-search setting versus browser automation and system-Chrome preference; trace their separate runtime consumers. | Settings and client-specific chat tools. Native `webfetch`/`websearch` does not establish browser-automation equivalence. |
| Notifications/display/language: corresponding settings tabs | Attention sounds/events, reasoning collapse, token-throughput/approval-reason display, tool rendering, shortcuts and locale coverage. | Reuse v2 notification/theme/input primitives; settings and VS Code renderer own remaining policy. Do not replay notification sounds during observation. |
| Experimental controls: `webview-ui/src/components/settings/ExperimentalTab.tsx` | Remote startup, sharing policy, formatter/LSP, batch tools, image generation/model, shared board, notebook tools, continue-on-deny, multi-project, browser automation, task-model choice and MCP timeout. Record each gate and backend separately. | Settings-key mapping and relevant runtime/client rows. An experimental toggle is not evidence of supported v2 execution; native engine matches require exact behavior checks. |
| KiloClaw: `package.json` command contributions | Registered entry point is source-present. Resolve its product boundary and whether it is an external handoff or a port requirement. | **Unassigned scope candidate**, not silently included in cloud CLI or marked obsolete. No completion credit; scope decision can remain deferred. |

The existing model/agent/sidebar follow-up in the plan remains authoritative
for Gateway-first presentation, Kilo auto metadata, balance/Pass privacy and
refresh, native agent policy, custom Plan transitions and sidebar sections.
This ledger adds details and cross-client distinctions rather than replacing it.

## How to keep the inventory honest

For each implementation slice, record: source SHA/version, client surface,
underlying provider/API/schema field, native v2 equivalent, remaining Kilo
delta, owning inventory row, and the exact positive/negative test evidence.
Use a missing-data state when the backing field cannot be verified. Do not
infer that an extension screenshot is the required CLI layout.

The historical `25/43 (58.1%)` figure is a **coarse capability-row checkpoint**, not
a measured percentage of all Kilo user workflows. New detail under unfinished
rows does not change its arithmetic; a gap within an actually completed row
must reopen that row. Truly unassigned capabilities stay visible as scope
candidates, and any future denominator change needs an explicit versioned
inventory revision rather than silently preserving a favorable percentage.

The subsequent [memory correction](memory-v2-parity.md) reopened one completed
row; current coarse coverage is **24/43 (55.8%)**.

## Completed self-test observations (older runtime)

Framework: `/Users/johnnyamancio/.config/kilo/scripts/vscode-self-test/cli.mjs`;
delegate `thr_7bdux6wma9`. VS Code `1.135.0` arm64. Existing extension artifact
SHA-256 `713bac9cf684a46e9e0f143e9597dd3cf9f782245ce72df6e33506160faab7d2`;
bundled CLI SHA-256 `5e8a5ac27339df6df19e156451e808baade23aebe2c9a2187a8619ab5ebab1fb`.
These hashes identify the observed binaries, not their source commit.

| UI-observed surface | Concrete observations | Acceptance / boundary correction |
|---|---|---|
| First-run choice | Review First versus High Autonomy, with permission/detail descriptions | Add permission-policy and disclosure presets to the existing onboarding/settings checklist. Visible descriptions do not prove enforcement. |
| Models | Auto Frontier/Balanced/Efficient/Free; Recommended; FREE badges; provider groups. Default, Small, Subagent, Autocomplete and Speech-to-Text fields; prompt-training-model filter and per-mode overrides | Confirms grouping/settings surfaces in the older runtime. Does not prove current eligible catalogs or model execution. |
| Agents | Code/Ask/Debug/Orchestrator/Plan primary picker; Explore/General labeled subagents; Orchestrator deprecated in settings | Record deprecated visibility discrepancy: new v2 policy intentionally omits Orchestrator rather than claiming exact picker parity. |
| Plan | Visible statement restricting edits to plan files | Supports the Plan boundary acceptance item; no edit/exit/implementation transition was exercised. |
| Permissions | Session Cost Alert and per-tool matrix; External Directory/Bash/Doom Loop Ask, most others Allow in this fixture | Do not infer user defaults or runtime enforcement from settings labels. |
| Memory / context | Disabled project memory, separate auto-save, Inspect/storage, compaction threshold and pruning | Supports separate consent and settings requirements; none was enabled or modified. |
| Indexing / sandbox | Project/global indexing controls and disabled status; embedding/vector settings. Sandbox network restriction, destinations, writable paths | Existing shell-only v2 confinement is not full displayed sandbox-policy parity. No index or sandbox action was run. |
| Web tools | Web Search, Playwright MCP browser automation, System Chrome, Headless | Keep web search separate from browser automation; neither was enabled. |
| Agent Manager | Worktrees/sessions, tabs, Run, search/advanced options and composer in a separate editor | Opening it wrote only disposable fixture metadata. No worktree/session/script action was exercised. |
| Other settings | Snapshots; inline/chat completion controls; notification sound/test; Local Config/Global Config/Reload; provider controls | Editor presentation remains Phase 5. No provider connection, sound test, completion, snapshot or config action was executed. |

The inert `GITHUB_TOKEN=invalid` isolation defense caused a GitHub Copilot
ENVIRONMENT-connected row; it is a harness artifact, not a real connection.
All HOME/XDG/profile/workspace state was isolated. The delegate verified no
`auth.json`, no prompt/model selection or inference, telemetry off, and no
Account Pooler access. Owned processes and disposable profile/workspace/socket
artifacts were cleaned up; the existing user window/stores were untouched.

Sanitized evidence: [model groups](/Users/johnnyamancio/.bb/thread-storage/thr_7bdux6wma9/v1-selftest-model-picker.png),
[agent configuration](/Users/johnnyamancio/.bb/thread-storage/thr_7bdux6wma9/v1-selftest-agent-behaviour.png),
[runtime agent picker](/Users/johnnyamancio/.bb/thread-storage/thr_7bdux6wma9/v1-selftest-agent-picker.png),
[first-run sidebar](/Users/johnnyamancio/.bb/thread-storage/thr_7bdux6wma9/v1-selftest-sidebar-inner.png),
[Agent Manager](/Users/johnnyamancio/.bb/thread-storage/thr_7bdux6wma9/v1-selftest-agent-manager.png).

This was framework-driven navigation and observation, not model/tool workflow
execution or live-contract verification. No completion credit is added.
