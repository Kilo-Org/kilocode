# Phased Plan — Port Kilo onto OpenCode v2

Updated: September 9, 2026  
Related issue: Kilo-Org/kilocode#13750  
Status: Implementation paused; source parity assessment complete.

## Summary

Port Kilo onto the native OpenCode v2 runtime while preserving the existing Kilo CLI, terminal UI, and product-client workflows. The VS Code deliverable is the **original Kilo extension**, including its interface and interactions, backed by v2.

The original capability checklist records **31 of 43 accepted capabilities (72.1%)**. This remains a historical baseline measure of broad capabilities, not an estimate of remaining effort or VS Code completion. The expanded inventory below separates those broad capabilities into smaller behaviors and exposes gaps identified by the completed source assessment. It deliberately does not assign a new percentage: its rows differ in size, overlap across clients, and have not all received equivalent runtime acceptance.

The source assessment covers **816 v1 files and 6,128 change annotations**, with no files left unclassified. It identifies both successful reuse and substantial remaining work. Where a detailed finding reveals a missing requirement inside a previously accepted capability, that acceptance must be revisited.

The original extension now builds and opens from `bun run extension`. Local adapters cover multiple workflows, but the full extension typecheck and complete original-UI acceptance remain unfinished. The latest response-completion and Stop correction passed focused real-host tests; final desktop verification remains pending.

## What this is not

- A replacement of the Kilo interface with the upstream application's interface.
- A second legacy runtime running alongside v2 inside the same session.
- Automatic migration of a live v1 database or configuration on startup.
- A claim that source presence, compilation, or fewer upstream patches establishes behavioral parity.
- A production release or a fully verified cross-platform distribution.

## Placement

| Responsibility | Preferred destination | Boundary |
|---|---|---|
| Gateway authentication, catalog and request policy | `packages/kilo-gateway` | Use native provider/integration and plugin interfaces. |
| Product identity, daemon, CLI commands and composition | `packages/kilo-cli` | Own product startup and registration; reuse native runtime services. |
| Memory, indexing and sandbox engines | Corresponding `packages/kilo-*` packages | Preserve domain behavior through explicit runtime integration. |
| Original VS Code host and backend adapters | `packages/kilo-vscode` | Use public v2 client APIs and Kilo RPCs; no private Core calls from the client. |
| Original browser UI and shared Kilo components | `packages/kilo-vscode/webview-ui`, `packages/kilo-ui`, `packages/kilo-ide-ui`, `packages/kilo-i18n` | Preserve original product behavior in owned source. |
| Browser-safe Kilo RPC definitions | `packages/schema/src/kilocode` | Share one typed contract between host and clients. |
| Generic execution and persistence | Native v2 Core, Protocol, Server and Client | Extend only when an existing public interface cannot carry the requirement. |
| Shared UI/runtime extension points | Narrow upstream-facing hooks | Keep policy in owned packages and document unavoidable shared changes. |

## Fork boundary and upstream updates

Prefer an existing plugin interface, then a host composition interface, before changing shared upstream files. Kilo-owned copies and new Kilo packages do not need inherited patch annotations solely because their source originated upstream. Shared modifications still need clear ownership and a reason they cannot live behind an existing interface.

A relocation is complete only when the consuming workflow preserves its required behavior. Native equivalents must be checked for scope, errors, cancellation, persistence, and presentation rather than inferred from names or file presence.

## Store and config

The v2 preview has separate configuration and storage from stable v1. Imports are opt-in and preserve the original source. Supported configuration mappings are explicit; unsupported values are refused rather than silently discarded.

Settings writes use the existing configuration authority with profile/project scope and revision checks. Explicit refresh reloads configuration without disposing active sessions or terminal processes. This is distinct from supporting every v1 setting: collection semantics, feature controls, and each original client's consumption still require verification.

## Phases

| Phase | Deliverable | Exit criteria | Current position |
|---|---|---|---|
| 0 — Isolated identity | Separate preview binary, branding, configuration and data. | v1 and v2 run side by side; boot leaves the original store untouched. | Foundation implemented. |
| 1 — Kilo API integration | Kilo operations through native client and owned plugin/RPC interfaces. | Real Kilo operations work end to end without private runtime dependencies in clients. | Foundation implemented; service-specific gates remain. |
| 2 — Native conversation | Streaming, tools, permissions, interrupt, resume and reconnect. | A native conversation reaches idle and survives supported lifecycle transitions. | Runtime paths implemented; product-client acceptance remains. |
| 3 — Runtime integrations | Gateway, memory, indexing, sandbox, telemetry, agents and skills. | Required behavior is implemented or explicitly superseded, with consumer evidence. | Broad coverage; detailed parity gaps remain. |
| 4 — CLI / TUI remainder | Commands, settings, presentation, remote, cloud and packaging. | CLI/TUI requirements pass their behavior-specific acceptance. | Many broad capabilities accepted; audit findings require follow-up. |
| 5 — Product clients | Original VS Code extension, Agent Manager and JetBrains. | Original workflows operate through v2 without mixing v1 and v2 session routes. | Original VS Code port in progress. |
| 6 — Import / canary / cutover | Explicit migration and isolated rollout. | Imports preserve originals; distribution and rollout gates pass. | Import foundations implemented; release gates open. |

## Inventory and progress

### Reading the inventory

- **Implemented**: the stated slice has an implementation and recorded local verification; this is not a release-wide guarantee.
- **Native reuse**: v2 supplies the stated generic behavior; Kilo-specific differences are listed separately.
- **Partial**: working behavior exists, with concrete missing scope or acceptance.
- **Needs port**: required behavior has no established complete implementation.
- **Deferred**: identified scope awaits a later implementation or external dependency.
- **Not needed**: the original item is obsolete in the target design.

### Identity, Gateway and model policy

| Capability | Destination | Phase | Progress | Remaining scope / acceptance |
|---|---|---|---|---|
| Kilo branding and isolated preview identity | Kilo CLI and theme integration | 0 | Implemented | Full legacy theme catalogue is a separate requirement. |
| Separate configuration/data directories | Kilo CLI host | 0 | Implemented | Preserve isolation during release and import rollout. |
| Local daemon, serve and attach | Kilo CLI host | 1 | Implemented | Each client must verify its connection lifecycle. |
| Native generated client | v2 Client / Protocol | 1 | Native reuse | Keep Kilo client adapters on public contracts. |
| Gateway device authentication and profile | Kilo Gateway | 1 | Implemented | Original extension authentication variants remain partial. |
| Organization selection and scoped requests | Kilo Gateway and clients | 1 | Implemented | Complete original-client acceptance and external service verification. |
| Catalog, BYOK and model routing | Kilo Gateway | 1, 4 | Implemented | Preserve provider-specific behavior in original UI adapters. |
| Catalog system-prompt selectors | Kilo CLI model policy | 1, 4 | Implemented | All eight selectors have source-backed adaptations and local wire coverage. |
| Training/privacy request policy | Kilo Gateway and settings | 3, 4 | Implemented | Verify remaining original settings consumers. |
| Startup catalog snapshot reuse | Kilo Gateway | 1 | Implemented | Identity/age checks and retention on transport failure are locally covered. |
| Model information, pricing and context tiers | Kilo CLI model-info UI | 4 | Implemented | Original picker-attached presentation is a separate partial item. |
| Account balance, Pass and routed-model display | Kilo CLI sidebar | 4 | Implemented | Local renderer coverage does not verify deployed account services. |

### Conversation runtime and behavior

| Capability | Destination | Phase | Progress | Remaining scope / acceptance |
|---|---|---|---|---|
| Durable prompt admission and execution | Native v2 sessions | 2 | Native reuse | Preserve client event translation and lifecycle boundaries. |
| Streaming conversation, history and resume | Kilo CLI over native client | 2 | Implemented | Original VS Code end-to-end acceptance remains partial. |
| Permissions and questions/forms | Native v2 with Kilo adapters | 2 | Implemented | Validate each original UI caller and policy variant. |
| Response completion and Stop in original extension | VS Code session adapter | 2, 5 | Partial | Focused host regression passes; final desktop verification pending. |
| Session fork, compaction and snapshots | Native v2 runtime | 2 | Native reuse | Generic functionality does not cover all Kilo snapshot/overflow rules below. |
| Offline wait and network recovery interaction | Kilo session policy / client integration | 2, 4, 5 | Needs port | Restore detection, user reply/reject, cancellation and visible waiting lifecycle. |
| Kilo overflow accounting and proactive thresholds | Kilo policy over native compaction | 2 | Partial | Native overflow rebuild exists; exact token/economic threshold behavior is unproven. |
| Slow snapshot interaction | Snapshot policy and UI | 2, 4, 5 | Partial | Timeout question, persisted disable choice and initialization feedback remain missing. |
| Snapshot retention, concurrency and detailed restore/diff behavior | Snapshot runtime and client adapters | 2, 5 | Partial | Audit identifies pruning, locking, validation and editor detail gaps. |
| Native session transfer and explicit foreign-format import | Kilo CLI | 4, 6 | Implemented | Preserve source data and verify supported formats independently. |
| Session message deletion for original client | Public runtime operation and VS Code adapter | 5 | Needs port | No established complete replacement for the original caller. |

### Runtime integrations, settings and CLI

| Capability | Destination | Phase | Progress | Remaining scope / acceptance |
|---|---|---|---|---|
| Memory engine and CLI/TUI operations | Kilo memory and CLI plugin | 3, 4 | Implemented | Durable injection indicators and detailed original-client parity remain separate. |
| Original extension memory adapter | VS Code backend and shared Memory RPC | 5 | Implemented | Full UI acceptance remains pending. |
| Codebase indexing runtime | Kilo indexing integration | 3 | Implemented | Original extension write controls and remaining cloud/indexing paths are incomplete. |
| Shell sandbox confinement | Kilo sandbox / CLI | 3 | Implemented | Cross-platform release validation remains open. |
| Local MCP spawn confinement | Kilo host policy and native MCP hook | 3 | Implemented | Lifecycle and fail-closed behavior have focused local coverage. |
| Interactive PTY refusal under sandbox | Kilo host decorators | 3 | Implemented | Covers normal and persistent terminal creation. |
| Original sandbox controls and v1 policy variants | Kilo settings and VS Code adapter | 3, 5 | Partial | Settings, toggle and inheritance semantics need full parity. |
| Telemetry integration | Kilo runtime integration | 3 | Implemented | Original extension capture/proxy surface remains separate. |
| Swarm orchestration | Kilo plugin and host policy | 3 | Implemented | Does not complete Agent Manager or notebook control planes. |
| Skills and custom agents | Native services with Kilo discovery | 3 | Implemented | Original removal/management callers remain incomplete. |
| Project configuration discovery | Kilo CLI host | 0, 3 | Implemented | Keep native configuration folding authoritative. |
| Profile/project scalar settings | Kilo settings store and RPC | 4 | Implemented | Supported fields are explicit; no general v1 settings parity claim. |
| Provider, agent, permission and policy collections | Kilo settings store and adapters | 4, 5 | Implemented | Complete all original editor flows and collection semantics. |
| Configuration diagnostics and live refresh | Kilo settings RPC / native reload | 4, 5 | Implemented | Real-host regression preserves session and PTY identity. |
| Generic review command | Native command plugin | 4 | Native reuse | Kilo review policy is maintained separately. |
| Kilo review policy and Plan workflow | Kilo CLI plugins | 4 | Implemented | Remaining presentation differences follow the source audit. |
| Headless prompt, resume and explicit auto mode | Kilo CLI | 2, 4 | Implemented | No implicit approval policy changes. |
| Piped input, local attachments and final JSON | Kilo CLI | 4 | Implemented | Keep per-command contract verification. |
| CLI model/agent inventory | Kilo CLI | 4 | Implemented | Provider-specific UI selection differences remain separate. |
| ACP host surface | Kilo CLI over native ACP | 4 | Implemented | Generic native ACP alone is not the product launcher. |

### Terminal UI details

| Capability | Destination | Phase | Progress | Remaining scope / acceptance |
|---|---|---|---|---|
| Kilo sidebar and process lifecycle | Kilo TUI plugin | 4 | Implemented | Local real-host restart and live-PID tests cover the stated process behavior. |
| Persistent appearance/input settings | Kilo host and native TUI settings | 4 | Implemented | Does not imply all legacy bindings or themes are present. |
| Picker policy and model details | Kilo model policy and native picker | 4 | Partial | Exact inline wide preview and section/search interaction differ. |
| Provider/integration dialogs | Native integration UI with Kilo policy | 4 | Partial | Provider-specific guidance, failure details and automatic method presentation remain. |
| Legacy Kilo theme catalogue and fallback | Owned theme assets / TUI integration | 4 | Partial | Complete selectable Kilo, Kilo-v1 and colorblind themes are not established. |
| Completion, abort and timeout notifications | TUI notification policy | 4 | Partial | Interrupted/subagent completion and friendly timeout behavior differ from v1. |
| Session scope switching and list actions | TUI session UI | 4 | Needs port | Preserve audited scope switching, empty-state actions and export choices. |
| Location-filtered direct event subscriptions | TUI event integration | 4 | Partial | Native location metadata exists; foreign-project filtering regression remains. |
| Multiline alerts and fixed-width Markdown tables | TUI presentation | 4 | Needs port | Exact legacy rendering behavior is not established. |
| Legacy feedback/Vim/news bindings and default sound | TUI configuration and actions | 4 | Needs port | Native primitives do not establish the original bindings and defaults. |
| Status/footer guidance and presence display | Kilo TUI presentation | 4 | Partial | Version/config guidance, onboarding and remote presence details remain. |

### Remote, sharing and distribution

| Capability | Destination | Phase | Progress | Remaining scope / acceptance |
|---|---|---|---|---|
| Remote transcript, queue and interaction translation | Kilo remote adapter | 4 | Partial | Local coverage exists; deployed relay/consumer acceptance remains open. |
| Remote inline attachments and capability advertisement | Kilo remote adapter | 4 | Implemented | External attachment workflow acceptance remains pending. |
| Remote session detach/exit | Kilo remote adapter | 4 | Implemented | Local ownership, cancellation and heartbeat fence are covered. |
| Remote suggestions | Kilo suggestion tool and adapter | 4 | Implemented | Local subscription, settlement, replay and cancellation covered; not original IDE suggestion parity. |
| Share/unshare/fork client operations | Kilo Gateway and client UI | 1, 5 | Partial | Local paths exist; full backend/viewer acceptance remains open. |
| Public shared-transcript viewer | Cloud viewer | 1, 5 | Needs port | Verify rendering of self-contained v2 messages. |
| Team sharing ownership | Gateway and sharing backend | 1, 5 | Deferred | Keep team upload refusal until backend acceptance is established. |
| Incremental sharing and deletion/revert semantics | Sharing backend and synchronization | 1, 5 | Needs port | Settle tombstone or replacement contract before enabling synchronization. |
| Cloud CLI client | Kilo CLI / Gateway | 4 | Implemented | External integration is not established by local fixtures. |
| Viewer presence registry and relay | Kilo presence service and RPC | 3, 5 | Partial | Complete host registration, consumers and real-host integration; relay verified locally only. |
| Local directory update and rollback | Kilo updater | 4 | Implemented | Real artifact staging, integrity and pointer switching locally verified. |
| Archive update transport | Kilo packaging/updater | 4 | Deferred | Safe extraction tooling remains gated. |
| Signing, hosted updates and platform delivery | Release tooling | 4, 6 | Deferred | Signing/notarization, distribution and full platform acceptance remain open. |
| Kilo CI and build hardening | Repository workflows/tooling | 6 | Partial | Audit identifies remaining cache, native-build and platform workflow requirements. |

### Original VS Code and remaining clients

| Capability | Destination | Phase | Progress | Remaining scope / acceptance |
|---|---|---|---|---|
| Original sidebar chat | Kilo VS Code host and webview | 5 | Partial | Original UI opens; finish contracts and native end-to-end acceptance. |
| Original editor tabs and restore | Kilo VS Code panels | 5 | Partial | Verify streaming, restore and independent panel session routing in original UI. |
| Original settings webview | Kilo VS Code and settings RPC | 5 | Partial | Backend slices work; complete all original controls and persistence acceptance. |
| Automatic local server connection | Kilo VS Code connection/startup | 5 | Implemented | Complete lifecycle acceptance alongside remaining original workflows. |
| Models, accounts and authentication adapter | Kilo VS Code backend | 5 | Partial | Tested basic flows; custom-provider and authentication variants remain. |
| Enhance prompt / commit / branch generation | Kilo generation RPC and VS Code adapter | 5 | Partial | Stateless backend verified; complete original editor/SCM consumers. |
| Terminal lifecycle and script terminals | Kilo VS Code adapter and ticket bridge | 5 | Partial | Real host/WS tests pass; complete native original-panel acceptance. |
| Agent Manager and notebook workflows | Original webviews with v2 services | 5 | Partial | UI builds; control-plane behavior is incomplete. |
| Original notifications and suggestions | Kilo VS Code backend/UI | 5 | Needs port | Complete the original request/reply and lifecycle contracts. |
| Agent and skill removal | Kilo VS Code management adapters | 5 | Needs port | Preserve original management semantics through public authority. |
| Task timeline and editor diff viewer | Original VS Code UI and adapters | 5 | Partial | Source availability does not establish full projection/detail behavior. |
| Inline autocomplete/FIM and next-edit | Editor services and Gateway | 5 | Needs port | Original editor consumers and service contracts remain. |
| Voice / speech-to-text | Original capture UI and transcription service | 5 | Deferred | Client integration and external provider acceptance remain. |
| Image generation and Claw | Feature-specific client/backend integrations | 5 | Needs port | Complete feature service contracts and consumers. |
| JetBrains plugin | Kilo v2 client integration | 5 | Deferred | Not accepted as ported. |
| Kilo Console capability in original checklist | — | — | Not needed | Recorded as obsolete in the baseline inventory. |

### Import and cutover

| Capability | Destination | Phase | Progress | Remaining scope / acceptance |
|---|---|---|---|---|
| Explicit credential import | Kilo CLI import | 6 | Implemented | Supported mappings only; preserve source credentials. |
| Kilo configuration key mapping | Kilo CLI import | 6 | Implemented | Unsupported-feature refusals are import safety, not feature completion. |
| Schema comparison and fixture migration | Kilo import tooling | 6 | Implemented | Continue coverage as supported mappings evolve. |
| Canary identity and release cutover | Product/release integration | 6 | Partial | Preview isolation exists; production rollout acceptance remains. |

## Check v2 overlap before porting v1 work

Reuse native permissions, MCP, compaction, session fork, plugins, subagents, daemon transport and other generic services. Compare the exact Kilo policy before treating those services as equivalent. For example, native retry does not implement the original offline-wait interaction, and native snapshot capture does not supply the original slow-snapshot question.

The complete file assessment has the following dispositions:

| Source disposition | Files |
|---|---:|
| Already ported | 65 |
| Native equivalent | 137 |
| Partial | 233 |
| Needs port | 163 |
| Deferred | 68 |
| Not needed | 150 |
| **Total** | **816** |

These file counts are not interchangeable with the inventory rows above. They include source, tests, configuration and tooling; a single capability can span many files, and one file can contain multiple behaviors.

## Current implementation and validation

Recorded verification includes focused package tests, isolated real-host execution, loopback service contracts, rendered UI fixtures, terminal round trips, and real local artifact apply/rollback. Earlier successful runs apply to their checkpoints and are not evidence that every current package is green.

The original extension and its six webviews/two workers build. The latest lifecycle regression verifies completed responses return to idle and interruption succeeds even without cached local activity. Full extension typechecking still fails on incomplete port surfaces, and final desktop verification of that correction remains unrun.

No new runtime acceptance is claimed by this document update or by completion of the source audit. External service verification, production distribution, and full platform validation remain open.

## Next steps

1. Resolve the original extension's missing contracts and typecheck failures, then run original-UI acceptance for chat, Stop, reconnect, panels, settings and terminals.
2. Prioritize audited behavior gaps and revisit broad accepted capabilities wherever the detailed requirements are not met.
3. Complete remaining remote/sharing contracts and client services, followed by external verification when permitted.
4. Finish packaging, platform and canary/cutover acceptance before release.
