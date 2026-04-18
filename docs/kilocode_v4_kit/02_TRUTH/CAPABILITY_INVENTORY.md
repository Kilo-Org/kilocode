# Current-State Capability Inventory

Date: 2026-04-17
Branch: feat/azure-voice-studio
Extension version: 7.2.6 (kilo-code)
Display name: "Kilo Code: Azure Voice Edition"

---

## Existing Capabilities (Built & Shipped)

### Core IDE Features

| Capability | Source Files | UI Surface | Status |
|---|---|---|---|
| **Sidebar Chat** | `src/KiloProvider.ts`, `webview-ui/src/components/chat/ChatView.tsx` | Activity bar sidebar webview | Shipped |
| **Open in Editor Tab** | `src/extension.ts` (openKiloInNewTab), `src/KiloProvider.ts` | Editor area panel (`kilo-code.new.TabPanel`) | Shipped |
| **Chat Message List** | `webview-ui/src/components/chat/MessageList.tsx`, `AssistantMessage.tsx` | Chat scroll view | Shipped |
| **Prompt Input** | `webview-ui/src/components/chat/PromptInput.tsx`, `prompt-input-utils.ts` | Text area with file mentions, drafts | Shipped |
| **Task Timeline** | `webview-ui/src/components/chat/TaskTimeline.tsx`, `TaskHeader.tsx` | Graph in chat header (toggleable via `showTaskTimeline`) | Shipped |
| **Permission System** | `webview-ui/src/components/chat/PermissionDock.tsx`, `PermissionCommand.tsx`, `PermissionDiff.tsx`, `src/kilo-provider/handlers/permission-handler.ts` | Inline dock with approve/deny, diff preview | Shipped |
| **Question Handling** | `webview-ui/src/components/chat/QuestionDock.tsx`, `src/kilo-provider/handlers/question.ts` | Inline Q&A dock | Shipped |
| **Session History** | `webview-ui/src/components/history/HistoryView.tsx`, `SessionList.tsx`, `CloudSessionList.tsx` | History panel (sidebar button) | Shipped |
| **Cloud Session Import** | `src/kilo-provider/handlers/cloud-session.ts`, `webview-ui/src/components/chat/CloudImportDialog.tsx` | URI handler (`vscode://kilocode.kilo-code/kilocode/s/{id}`), dialog | Shipped |
| **Context Menu Actions** | `src/services/code-actions/register-code-actions.ts`, `register-terminal-actions.ts` | Editor context menu (Explain/Fix/Improve/Add to Context), Terminal context menu | Shipped |
| **Code Action Provider** | `src/services/code-actions/code-action-provider.ts` | Lightbulb quick fixes in editor | Shipped |
| **Inline Autocomplete** | `src/services/autocomplete/` (17+ files), `AutocompleteServiceManager.ts`, `AutocompleteModel.ts` | Inline suggestions, status bar indicator | Shipped |
| **Chat Textarea Autocomplete** | `src/services/autocomplete/chat-autocomplete/ChatTextAreaAutocomplete.ts` | Autocomplete in prompt input | Shipped (behind config flag) |
| **Commit Message Generation** | `src/services/commit-message/index.ts` | SCM title bar button, command palette | Shipped |
| **Terminal Command Generation** | `src/extension.ts` (generateTerminalCommand handler) | Input box prompt, keybinding `Ctrl+Shift+G` | Shipped |
| **Agent Mode Cycling** | `src/extension.ts` (cycleAgentMode, cyclePreviousAgentMode) | Keybinding `Ctrl+.` / `Ctrl+Shift+.` | Shipped |
| **Auto-Approve Toggle** | `src/commands/toggle-auto-approve.ts` | Keybinding `Ctrl+Alt+A` | Shipped |
| **Focus Chat Shortcut** | `src/extension.ts` | Keybinding `Ctrl+Shift+A` | Shipped |
| **Diff Viewer** | `src/DiffViewerProvider.ts`, `src/review-utils.ts` | Full-screen editor tab for workspace diffs, review comments | Shipped |
| **Diff Virtual Provider** | `src/DiffVirtualProvider.ts` | Lightweight single-file diff for permission approval | Shipped |
| **Image Preview** | `src/image-preview.ts` | Inline image rendering in chat | Shipped |
| **Sub-Agent Viewer** | `src/SubAgentViewerProvider.ts` | Read-only editor panel for child sessions | Shipped |
| **Notifications** | `webview-ui/src/context/notifications.tsx`, `webview-ui/src/components/chat/KiloNotifications.tsx` | Toast notifications, VS Code notifications | Shipped |
| **Feedback Dialog** | `webview-ui/src/components/chat/FeedbackDialog.tsx` | Modal dialog | Shipped |
| **Error Display** | `webview-ui/src/components/chat/ErrorDisplay.tsx`, `StartupErrorBanner.tsx` | Inline error banners | Shipped |
| **Revert Banner** | `webview-ui/src/components/chat/RevertBanner.tsx` | Undo/revert UI | Shipped |
| **Telemetry** | `src/services/telemetry/telemetry-proxy.ts`, `telemetry-proxy-utils.ts`, `errors.ts` | Background telemetry with error tracking | Shipped |
| **Multi-Language UI** | `webview-ui/src/context/language.tsx`, `src/services/cli-backend/i18n/` | 20 languages (en, zh, zht, ko, de, es, fr, da, ja, pl, ru, ar, no, br, th, bs, tr, nl, uk) | Shipped |
| **Browser Automation** | `src/services/browser-automation/browser-automation-service.ts` | Playwright MCP registration, VS Code settings toggle | Shipped |
| **Legacy Migration** | `src/legacy-migration/`, `src/kilo-provider/handlers/migration.ts`, `webview-ui/src/components/migration/` | Migration wizard UI | Shipped |
| **Remote Control** | `src/services/RemoteStatusService.ts` | Status bar item, toggle command | Shipped |
| **Claude Code Compat** | VS Code config `kilo-code.new.claudeCodeCompat` | Setting to load CLAUDE.md instructions/skills | Shipped |

### Settings & Configuration UI

| Capability | Source Files | UI Surface | Status |
|---|---|---|---|
| **Settings Editor Panel** | `src/SettingsEditorProvider.ts` | Full editor-area panel (singleton) | Shipped |
| **Providers Tab** | `webview-ui/src/components/settings/ProvidersTab.tsx`, `ProviderConnectDialog.tsx`, `ProviderSelectDialog.tsx`, `CustomProviderDialog.tsx` | Provider list, connect/disconnect, custom providers, OAuth | Shipped |
| **Models Tab** | `webview-ui/src/components/settings/ModelsTab.tsx` | Model selection, favorites | Shipped |
| **Agent Behaviour Tab** | `webview-ui/src/components/settings/AgentBehaviourTab.tsx`, `agent-behaviour/` | Mode management, custom instructions | Shipped |
| **Mode Editor** | `webview-ui/src/components/settings/ModeCreateView.tsx`, `ModeEditView.tsx` | Create/edit custom agent modes | Shipped |
| **Auto-Approve Tab** | `webview-ui/src/components/settings/AutoApproveTab.tsx` | Per-action auto-approve toggles | Shipped |
| **Context Tab** | `webview-ui/src/components/settings/ContextTab.tsx` | Context window management | Shipped |
| **Autocomplete Tab** | `webview-ui/src/components/settings/AutocompleteTab.tsx` | Autocomplete configuration | Shipped |
| **Browser Tab** | `webview-ui/src/components/settings/BrowserTab.tsx` | Browser automation settings | Shipped |
| **Checkpoints Tab** | `webview-ui/src/components/settings/CheckpointsTab.tsx` | Checkpoint/snapshot management | Shipped |
| **Display Tab** | `webview-ui/src/components/settings/DisplayTab.tsx` | Visual preferences | Shipped |
| **Language Tab** | `webview-ui/src/components/settings/LanguageTab.tsx` | UI language selection | Shipped |
| **Notifications Tab** | `webview-ui/src/components/settings/NotificationsTab.tsx` | Notification & sound preferences | Shipped |
| **Experimental Tab** | `webview-ui/src/components/settings/ExperimentalTab.tsx` | Feature flags and experimental options | Shipped |
| **About Tab** | `webview-ui/src/components/settings/AboutKiloCodeTab.tsx` | Version info, links | Shipped |
| **Speech Tab** | `webview-ui/src/components/settings/SpeechTab.tsx` | Multi-provider TTS configuration | Shipped |
| **Profile View** | `webview-ui/src/components/profile/ProfileView.tsx`, `DeviceAuthCard.tsx` | Login/logout, organization, device auth | Shipped |
| **Marketplace** | `webview-ui/src/components/marketplace/MarketplaceView.tsx`, `ItemCard.tsx`, `InstallModal.tsx`, `RemoveDialog.tsx` | MCP server marketplace, install/remove | Shipped |
| **MCP Editor** | `webview-ui/src/components/settings/McpEditView.tsx` | MCP server configuration editor | Shipped |

### Agent Manager

| Capability | Source Files | UI Surface | Status |
|---|---|---|---|
| **Agent Manager Panel** | `src/agent-manager/AgentManagerProvider.ts` | Full editor-area panel with toolbar buttons | Shipped |
| **Worktree Management** | `src/agent-manager/WorktreeManager.ts` | Create, open, close, advanced create worktrees in `.kilo/worktrees/` | Shipped |
| **Worktree State Persistence** | `src/agent-manager/WorktreeStateManager.ts` | JSON state in `.kilo/agent-manager.json` | Shipped |
| **Session Terminal Manager** | `src/agent-manager/SessionTerminalManager.ts` | Per-session VS Code terminal instances | Shipped |
| **Git Operations** | `src/agent-manager/GitOps.ts` | Branch operations, diffs, status | Shipped |
| **Git Stats Polling** | `src/agent-manager/GitStatsPoller.ts`, `src/kilo-provider/stats-polling.ts` | Periodic git status updates | Shipped |
| **PR Status Bridge** | `src/agent-manager/PRStatusPoller.ts`, `pr-status-bridge.ts` | Poll and display PR status | Shipped |
| **Setup Script System** | `src/agent-manager/SetupScriptService.ts`, `SetupScriptRunner.ts`, `setup-script-template.ts` | Run setup scripts in new worktrees (VS Code task type `kilo-worktree-setup`) | Shipped |
| **Worktree Diff Controller** | `src/agent-manager/worktree-diff-controller.ts` | Toggle diff panel within Agent Manager | Shipped |
| **Worktree Importer** | `src/agent-manager/worktree-importer.ts` | Import external worktrees | Shipped |
| **Session Forking** | `src/agent-manager/fork-session.ts` | Fork a session into a new worktree | Shipped |
| **Continue in Worktree** | `src/agent-manager/continue-in-worktree.ts`, `src/kilo-provider/continue-worktree.ts` | Bridge from sidebar chat to Agent Manager worktree | Shipped |
| **Branch Name Generation** | `src/agent-manager/branch-name.ts`, `friendly-words.d.ts` | Auto-generate friendly branch names | Shipped |
| **Env File Copy** | `src/agent-manager/env-copy.ts` | Copy `.env` files into new worktrees | Shipped |
| **Git Transfer** | `src/agent-manager/git-transfer.ts` | Transfer commits between worktrees | Shipped |
| **Multi-Version Sessions** | `src/agent-manager/multi-version.ts` | Run same task across multiple model versions | Shipped |
| **Run Script System** | `src/agent-manager/run/controller.ts`, `manager.ts`, `service.ts`, `task.ts`, `message.ts` | Execute scripts within worktree context | Shipped |
| **Keyboard Navigation** | Agent Manager keybindings (9 jumpTo, prev/next session/tab, new/close tab/worktree) | Full keyboard shortcut set (`Ctrl+Alt+arrows`, `Ctrl+1-9`, etc.) | Shipped |

### Speech Synthesis (Azure Voice Edition)

| Capability | Source Files | UI Surface | Status |
|---|---|---|---|
| **Speech Provider Registry** | `webview-ui/src/data/speech-providers.ts` | Pluggable provider system with register/get/list/listByTier | Shipped |
| **Browser TTS Provider** | `webview-ui/src/utils/speech-providers/browser-provider.ts` | Web Speech API (free, no key required) | Shipped |
| **Azure TTS Provider** | `webview-ui/src/utils/speech-providers/azure-provider.ts` | Azure Cognitive Services Neural TTS | Shipped |
| **Google TTS Provider** | `webview-ui/src/utils/speech-providers/google-provider.ts` | Google Cloud Text-to-Speech | Shipped |
| **OpenAI TTS Provider** | `webview-ui/src/utils/speech-providers/openai-provider.ts` | OpenAI TTS API | Shipped |
| **ElevenLabs TTS Provider** | `webview-ui/src/utils/speech-providers/elevenlabs-provider.ts` | ElevenLabs voice synthesis | Shipped |
| **Amazon Polly Provider** | `webview-ui/src/utils/speech-providers/polly-provider.ts` | AWS Polly TTS | Shipped |
| **Speech Playback Engine** | `webview-ui/src/utils/speech-playback.ts` | Audio playback, volume control, stop/start | Shipped |
| **Speech Text Filter** | `webview-ui/src/utils/speech-text-filter.ts` | Strip code blocks, markdown, filter for natural speech | Shipped |
| **Sentiment Detection** | `webview-ui/src/utils/speech-text-filter.ts` (detectSentiment) | Adjust pitch/rate based on emotional tone | Shipped |
| **Azure SSML Builder** | `webview-ui/src/utils/tts-azure.ts` | Generate SSML markup for Azure Neural voices | Shipped |
| **Speech Settings UI** | `webview-ui/src/components/settings/SpeechTab.tsx` | Full settings tab: provider select, voice browse, tuning, presets, API key validation | Shipped |
| **Auto-Speak** | `webview-ui/src/App.tsx` (speech integration) | Automatically speak completed assistant replies | Shipped |
| **Voice Presets** | `webview-ui/src/types/voice.ts` (VoicePreset) | Save/load voice + tuning presets | Shipped |
| **Voice Favorites** | `webview-ui/src/types/voice.ts` (FavoritesConfig) | Star voices, custom ordering | Shipped |
| **Pronunciation Overrides** | `webview-ui/src/types/voice.ts` (PronunciationEntry) | Custom pronunciation for technical terms | Shipped |
| **Multi-Voice Mode** | VS Code config `speech.multiVoiceMode` | Each AI agent speaks in a distinct voice | Shipped (config wired) |
| **Interaction Modes** | VS Code config `speech.interactionMode` | assist / conversation / minimal modes | Shipped |
| **Interrupt on Type** | VS Code config `speech.interruptOnType` | Stop speech when user starts typing | Shipped |
| **VS Code Config Schema** | `package.json` contributes.configuration | 25+ speech config keys registered in VS Code settings | Shipped |

### Hermes Pipeline Integration

| Capability | Source Files | UI Surface | Status |
|---|---|---|---|
| **Hermes Client** | `src/services/hermes/HermesClient.ts` | HTTP client for Bridge API (health, submitTask, pollStatus, subscribe SSE) | Shipped (disabled by default) |
| **Hermes Pipeline Orchestrator** | `src/services/hermes/HermesPipeline.ts` | Build TaskEnvelope, POST to Hermes, subscribe to SSE events, handle approval prompts | Shipped (disabled by default) |
| **Hermes Status Service** | `src/services/hermes/HermesStatusService.ts` | Status bar item, enabled/disabled toggle, periodic bridge pings | Shipped (disabled by default) |
| **Hermes Provider Preset** | `src/services/hermes/HermesProviderPreset.ts` | Auto-register Hermes as a provider in CLI backend config | Shipped |
| **Hermes Secret Management** | `src/services/hermes/secrets.ts` | VS Code SecretStorage + env var fallback chain (HERMES_API_KEY, KILOCODE_API_KEY, MINIMAX_API_KEY, ANTHROPIC_API_KEY) | Shipped |
| **Hermes Commands** | `src/commands/hermes.ts` | Toggle Pipeline, Set/Clear API Key, Test Connection | Shipped |
| **Task Envelope Types** | `src/services/hermes/types.ts` | TaskEnvelope, TaskState machine (queued -> planning -> awaiting_approval -> executing_in_zeroclaw -> validating -> completed/failed/rolled_back), TaskEvent, TaskStatus, HermesHealth | Shipped |
| **VS Code Config** | `package.json` (hermes section) | `enabled`, `baseUrl`, `approvalMode` (auto-all/auto-low/manual), `workspaceScopeOnly` | Shipped |

### Services

| Service | Source Files | Purpose | Status |
|---|---|---|---|
| **CLI Backend** | `src/services/cli-backend/connection-service.ts`, `server-manager.ts`, `sdk-sse-adapter.ts`, `connection-utils.ts`, `server-utils.ts`, `retry.ts` | Spawn/manage CLI backend process, SDK client connection, SSE event streaming | Shipped |
| **Autocomplete** | `src/services/autocomplete/` (17+ files across 5 subdirs) | Inline code completion with model routing, status bar, code action suggestions | Shipped |
| **Browser Automation** | `src/services/browser-automation/browser-automation-service.ts` | Playwright MCP server registration for web interaction | Shipped |
| **Code Actions** | `src/services/code-actions/` (6 files) | Editor lightbulb fixes, context menus, terminal actions, support prompts | Shipped |
| **Commit Message** | `src/services/commit-message/index.ts` | AI-generated git commit messages via SCM integration | Shipped |
| **Hermes** | `src/services/hermes/` (7 files) | Orchestration pipeline to Hermes Bridge API and ZeroClaw execution | Shipped (off by default) |
| **Marketplace** | `src/services/marketplace/` (6 files: api, detection, installer, paths, types) | MCP server discovery, installation, and removal | Shipped |
| **Remote Status** | `src/services/RemoteStatusService.ts` | Remote connection status bar management | Shipped |
| **Telemetry** | `src/services/telemetry/` (5 files) | Usage analytics, error reporting | Shipped |

### Shared / Utility Modules

| Module | Source Files | Purpose | Status |
|---|---|---|---|
| **Provider Model** | `src/shared/provider-model.ts` | Parse model strings, KILO_AUTO constant | Shipped |
| **Custom Provider** | `src/shared/custom-provider.ts` | Validate/sanitize custom provider configs | Shipped |
| **Fetch Models** | `src/shared/fetch-models.ts` | Model list fetching | Shipped |
| **Path Utils** | `src/path-utils.ts` | Absolute path detection | Shipped |
| **Project Directory** | `src/project-directory.ts` | Resolve workspace/project directories | Shipped |
| **Session Status** | `src/session-status.ts` | Busy session counting, status seeding | Shipped |
| **Retry Utilities** | `src/util/retry.ts` | Retryable operations with backoff | Shipped |
| **Webview HTML** | `src/utils.ts`, `src/webview-html-utils.ts` | Build webview HTML, CSP headers | Shipped |

### Webview Context Providers

| Context | Source Files | Purpose |
|---|---|---|
| **VSCodeProvider** | `webview-ui/src/context/vscode.tsx` | VS Code API bridge (postMessage, state) |
| **ServerProvider** | `webview-ui/src/context/server.tsx` | CLI backend connection state |
| **ProviderProvider** | `webview-ui/src/context/provider.tsx` | AI provider list and selection |
| **ConfigProvider** | `webview-ui/src/context/config.tsx` | Global and session config |
| **SessionProvider** | `webview-ui/src/context/session.tsx` | Active session management |
| **LanguageProvider** | `webview-ui/src/context/language.tsx` | i18n translations |
| **NotificationsProvider** | `webview-ui/src/context/notifications.tsx` | Toast/notification queue |
| **WorktreeMode** | `webview-ui/src/context/worktree-mode.tsx` | Worktree-aware context |

### Test Coverage

| Area | Test Files | Count |
|---|---|---|
| **Unit Tests** | `tests/unit/` | 100+ test files |
| **Visual Regression** | `tests/visual-regression.spec.ts` | Playwright snapshot tests |
| **Permission Dock** | `tests/permission-dock-dropdown.spec.ts` | Component-level specs |
| **Extension Test** | `src/test/extension.test.ts` | Basic activation test |

Notable tested areas: agent-manager architecture, autocomplete, speech providers, hermes envelope, git operations, worktree management, code actions, telemetry, provider actions, session utilities, diff state, i18n, and more.

---

## Planned Capabilities (Not Yet Built)

### SSH / Remote Systems
- No SSH service exists in `src/services/`
- No SSH-related commands registered in `package.json`
- `RemoteStatusService.ts` exists but handles CLI backend remote toggle only -- it does not provide SSH tunnel/connection management
- No terminal forwarding or remote file system integration
- **Required:** SSH tunnel manager, remote workspace mounting, connection profiles, key management

### VPS / Infrastructure
- No VPS provisioning or management code anywhere in the extension
- No cloud provider SDK integrations (AWS EC2, Azure VM, DigitalOcean, etc.)
- No infrastructure-as-code templates or deployment workflows
- **Required:** VPS provisioner, deployment pipeline, resource monitoring, cost tracking

### ZeroClaw Execution
- The Hermes pipeline types reference ZeroClaw (`executing_in_zeroclaw` state, `requires_execution` field)
- KiloCode intentionally does NOT build ZeroClaw jobs directly (per HermesPipeline.ts comments: "Never build ZeroClaw jobs directly -- that's Hermes's job")
- No local ZeroClaw runner or executor exists in the extension
- The bridge is wired: KiloCode submits TaskEnvelope to Hermes, Hermes manages ZeroClaw
- **Required (Hermes-side):** ZeroClaw job runner, sandboxed execution engine, artifact collection. KiloCode's role is UI/status only.

### Provider Routing
- Provider selection is manual (user picks from ProvidersTab)
- `kilo-auto/free` is the default model ID (auto-routing at Kilo backend level)
- No client-side intelligent routing, cost optimization, or fallback chains
- Hermes owns routing when pipeline is enabled ("Never choose a provider -- Hermes owns routing")
- **Required:** Client-side fallback chains, latency-based routing, cost budgets, model performance tracking

### Memory / Shiba
- No memory service exists in `src/services/`
- Hermes types reference `memory_ids_written` in TaskStatus, confirming Hermes owns Shiba
- HermesPipeline.ts explicitly states: "Never write memory -- Hermes owns Shiba"
- No local knowledge base, conversation memory, or RAG integration
- **Required:** Local session memory, cross-session knowledge retrieval, Shiba bridge for Hermes-managed memory

### Training / GPU
- No training, fine-tuning, or GPU management code
- No LoRA/adapter management
- No dataset preparation or evaluation tooling
- **Required:** Training job submission, GPU resource allocation, model evaluation dashboard

### Governance / Release
- No release management, staged rollout, or feature flag system beyond `ExperimentalTab`
- No audit logging beyond telemetry
- Hermes has `ApprovalMode` (auto-all/auto-low/manual) -- this is the only governance primitive
- No role-based access control
- **Required:** Release pipeline, staged rollouts, audit trail, RBAC, compliance reporting

---

## Gap Analysis

| Subsystem | Current State | Required State | Gap Size |
|---|---|---|---|
| **Core Chat / IDE** | Fully shipped: sidebar, tab panel, context menus, code actions, permissions, history, cloud sessions | Stable foundation -- extend, don't replace | None (maintenance only) |
| **Agent Manager** | Fully shipped: worktrees, sessions, terminals, diffs, PR status, setup scripts, multi-version, run scripts, full keyboard nav | Add SSH-aware worktrees, remote worktrees | Small |
| **Autocomplete** | Fully shipped: inline, chat textarea, model routing, status bar, code action suggestions | Performance tuning, more model support | Small |
| **Speech Synthesis** | Fully shipped: 6 providers (Browser, Azure, Google, OpenAI, ElevenLabs, Polly), playback engine, text filter, sentiment detection, SSML, presets, favorites, settings UI, 25+ config keys | Speech-to-text input, voice commands | Small |
| **Hermes Pipeline** | Shipped but disabled by default: client, pipeline, status bar, commands, secret management, provider preset sync, config UI | Enable by default once bridge is stable; add richer task status UI | Medium |
| **Settings / Config** | Fully shipped: 15+ settings tabs, provider management, mode editor, marketplace | Extend for new subsystems as they arrive | None |
| **Marketplace** | Fully shipped: MCP server discovery, install/remove, UI | Add categories, ratings, verified badges | Small |
| **Browser Automation** | Shipped: Playwright MCP, configurable headless/system Chrome | E2E test recording, visual assertions | Small |
| **Telemetry** | Shipped: proxy with error tracking | Add structured event taxonomy for new subsystems | Small |
| **SSH / Remote** | RemoteStatusService exists (remote toggle only) | Full SSH tunnel manager, remote FS, connection profiles, key management | **Large** |
| **VPS / Infrastructure** | Nothing exists | VPS provisioner, cloud SDKs, deploy pipelines, resource monitoring, cost tracking | **Large** |
| **ZeroClaw Execution** | Types and state machine defined; Hermes bridge wired | Hermes-side: build the actual executor. KiloCode-side: richer task progress UI, artifact viewer | **Large** (mostly Hermes-side) |
| **Provider Routing** | Manual selection + kilo-auto backend | Client-side fallback chains, latency routing, cost budgets, performance tracking | **Medium** |
| **Memory / Shiba** | Nothing in extension; Hermes owns it by design | Local session memory, cross-session retrieval, Shiba bridge UI | **Medium** |
| **Training / GPU** | Nothing exists | Training jobs, GPU allocation, model eval, dataset tools | **Large** |
| **Governance / Release** | Only ApprovalMode in Hermes config | Release pipeline, staged rollouts, audit trail, RBAC, compliance | **Large** |
| **i18n** | 20 languages shipped | Maintain coverage as new UI surfaces are added | Small |
| **Testing** | 100+ unit tests, visual regression, component specs | Add integration tests for Hermes pipeline, speech providers, Agent Manager E2E | Medium |

---

## Architecture Notes

### Extension Activation
- Activates on `onStartupFinished` (not on first sidebar open)
- CLI backend starts lazily (on webview connect or autocomplete trigger)
- Hermes pipeline is zero-cost when disabled (no pings, no status bar)

### Key Design Boundaries
1. **KiloCode never builds ZeroClaw jobs** -- submits TaskEnvelope to Hermes only
2. **KiloCode never writes memory** -- Hermes owns Shiba
3. **KiloCode never chooses providers when Hermes is active** -- Hermes owns routing
4. **One CLI backend server** shared across all webviews (sidebar, tabs, Agent Manager, settings)
5. **SolidJS** webview framework (not React) -- all components use `solid-js` signals/effects

### Package Ecosystem
The monorepo contains 19 packages under `packages/`:
- `kilo-vscode` -- the VS Code extension (this inventory)
- `kilo-ui` -- shared UI component library (Card, Switch, Select, etc.)
- `sdk` -- TypeScript SDK for CLI backend communication
- `opencode` -- CLI tool
- `kilo-i18n` -- translation strings
- `kilo-telemetry` -- telemetry backend
- `kilo-gateway` -- API gateway
- `kilo-docs` -- documentation site
- `kilo-jetbrains` -- JetBrains plugin (separate IDE target)
- `desktop` / `desktop-electron` -- desktop app variants
- `app` / `containers` -- deployment artifacts
- `extensions` -- extension packs
- `plugin` -- plugin system
- `storybook` -- component stories
- `ui` -- additional UI packages
- `util` -- shared utilities
- `script` -- build/dev scripts

### Registered VS Code Commands (36 total)
- 6 toolbar commands (New Task, Agent Manager, Marketplace, History, Profile, Settings)
- 15 Agent Manager commands (navigation, worktree CRUD, terminal, diff, shortcuts, jumpTo1-9)
- 4 Hermes commands (toggle, setApiKey, clearApiKey, testConnection)
- 4 code action commands (explainCode, fixCode, improveCode, addToContext)
- 3 terminal commands (addToContext, fixCommand, explainCommand)
- 2 autocomplete commands (generateSuggestions, cancelSuggestions)
- 1 commit message command (generateCommitMessage)
- 1 terminal generation command (generateTerminalCommand)

### VS Code Configuration Keys (40+ total)
- `kilo-code.new.language` -- UI language override
- `kilo-code.new.model.providerID` / `modelID` -- default model
- `kilo-code.new.autocomplete.*` (3 keys) -- autocomplete toggles
- `kilo-code.new.claudeCodeCompat` -- CLAUDE.md compat
- `kilo-code.new.browserAutomation.*` (3 keys) -- Playwright settings
- `kilo-code.new.notifications.*` (3 keys) -- notification toggles
- `kilo-code.new.sounds.*` (3 keys) -- sound settings
- `kilo-code.new.showTaskTimeline` -- timeline toggle
- `kilo-code.new.speech.*` (25+ keys) -- speech provider, tuning, favorites, presets
- `kilo-code.new.hermes.*` (4 keys) -- pipeline toggle, baseUrl, approvalMode, workspaceScopeOnly
