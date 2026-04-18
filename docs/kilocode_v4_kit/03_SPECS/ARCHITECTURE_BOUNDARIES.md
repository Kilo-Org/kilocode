# Architecture Boundaries

Date: 2026-04-17
Version: 1.0.0
Status: Draft
Phase: 06 of 72-phase plan

---

## Current Architecture

KiloCode is a VS Code extension structured as a monorepo under `packages/kilo-vscode/`.
The runtime has three process boundaries that code must never cross directly:

```
VS Code Extension Host (Node.js)          Webview (Browser sandbox)
+---------------------------------+        +------------------------------+
| extension.ts (activation)       |        | index.tsx (Solid.js root)    |
|   |                             |        |   |                         |
|   +-- KiloProvider              |<------>|   +-- App.tsx               |
|   +-- AgentManagerProvider      |  post  |   +-- components/           |
|   +-- SettingsEditorProvider    | Message|   +-- context/              |
|   +-- DiffViewerProvider        |        |   +-- hooks/                |
|   +-- SubAgentViewerProvider    |        |   +-- utils/                |
|   |                             |        +------------------------------+
|   +-- services/                 |
|   |     +-- cli-backend/        |        CLI Backend (child process)
|   |     +-- hermes/             |        +------------------------------+
|   |     +-- autocomplete/       |        | opencode server              |
|   |     +-- browser-automation/ |<------>| REST + SSE on localhost      |
|   |     +-- code-actions/       |  HTTP  | @kilocode/sdk client         |
|   |     +-- commit-message/     |        +------------------------------+
|   |     +-- telemetry/          |
|   |     +-- marketplace/        |
|   |                             |
|   +-- agent-manager/            |
|   |     +-- WorktreeManager     |
|   |     +-- GitOps              |
|   |     +-- SessionTerminal     |
|   |                             |
|   +-- kilo-provider/            |
|   +-- shared/                   |
|   +-- util/                     |
+---------------------------------+
```

Key existing patterns:

1. **KiloConnectionService** (`services/cli-backend/connection-service.ts`) is the single gateway
   to the CLI backend. All HTTP/SSE traffic to the opencode server flows through it.
2. **KiloProvider** (`KiloProvider.ts`, ~131 KB) is the webview host. It handles `postMessage`
   dispatch for the sidebar and tab panels.
3. **AgentManagerProvider** manages worktrees, git operations, terminal sessions, and PR polling.
   It runs in the extension host and communicates with the webview via its own panel.
4. **Hermes services** (`services/hermes/`) are the first external-API subsystem. They follow a
   clean pattern: client class, pipeline orchestrator, status service, types, secrets, barrel export.

---

## Layer Model

Every piece of KiloCode code belongs to exactly one of these four layers.
If you are unsure where code goes, it belongs in the **Service Layer**.

| # | Layer | Runtime | Allowed dependencies | Examples |
|---|---|---|---|---|
| 1 | **Extension Host Layer** | Node.js (VS Code API) | VS Code API, Service Layer | `extension.ts`, command registrations, providers |
| 2 | **Service Layer** | Node.js (no VS Code UI) | Other services (via DI), External Layer, Node.js stdlib | `services/hermes/`, `services/cli-backend/`, `agent-manager/` |
| 3 | **Webview Layer** | Browser sandbox (Solid.js) | Webview context, postMessage only | `webview-ui/src/components/`, `webview-ui/src/context/` |
| 4 | **External Integration Layer** | Node.js (network I/O) | HTTP/WS clients, SDK wrappers | API clients for Hermes, ZeroClaw, Shiba, cloud providers |

### Layer Rules (non-negotiable)

- **L1 -> L2**: Extension Host Layer may instantiate and wire Service Layer classes.
- **L2 -> L2**: Services may depend on other services. Inject via constructor, never import singletons. No circular imports.
- **L2 -> L4**: Services call External clients. Never the reverse.
- **L1 <-> L3**: Extension Host and Webview communicate **only** via `postMessage` / `onMessage`. No shared memory, no direct function calls.
- **L3 -> L4**: Webview may call external APIs **only** when those endpoints are whitelisted in CSP and the call is purely read-only display data (e.g., TTS audio streaming). Write operations go through L1/L2.
- **L3 -/-> L2**: Webview never imports extension host code. Message types are defined in `webview-ui/src/types/` or `src/shared/`.

---

## Subsystem Boundaries

Each subsystem below is a self-contained vertical slice through the layer model.
Subsystems communicate with each other only through the Service Layer via explicit interfaces.

---

### 1. SSH / Remote Systems

**Purpose:** Manage SSH profiles, connections, remote terminals, and SFTP file operations.

| Layer | Location | Contents |
|---|---|---|
| Extension Host | `src/ssh/SshExtension.ts` | Command registrations, tree view providers |
| Service | `src/services/ssh/SshService.ts` | Connection pool, profile CRUD, keep-alive |
| Service | `src/services/ssh/SshProfileManager.ts` | Profile validation, YAML I/O |
| Service | `src/services/ssh/SftpService.ts` | File transfer, directory listing |
| Webview | `webview-ui/src/components/remote/` | Terminal panel, SFTP browser, connection status |
| External | `src/services/ssh/SshTransport.ts` | ssh2 library wrapper |
| Config | `config/ssh/profiles.yaml`, `config/ssh/groups.yaml` | Per spec |
| Types | `src/services/ssh/types.ts` | `SshProfile`, `SshConnection`, `SftpEntry` |

**Boundary rules:**

- All SSH connections go through `SshService`. No direct `net.Socket` or `ssh2.Client` usage outside `SshTransport`.
- Private keys and passphrases are resolved via `VS Code SecretStorage` at connect time, never held in memory longer than the connection handshake.
- The webview renders terminal output via a message stream; it never holds a socket reference.
- SFTP operations return serializable results (paths, stats, buffers as base64). No `SFTPStream` objects cross the postMessage boundary.

---

### 2. VPS / Infrastructure

**Purpose:** Provision, monitor, and manage VPS instances for remote agent execution.

| Layer | Location | Contents |
|---|---|---|
| Extension Host | `src/vps/VpsExtension.ts` | Command registrations, status bar items |
| Service | `src/services/vps/VpsService.ts` | Instance lifecycle (create, destroy, resize) |
| Service | `src/services/vps/VpsMonitor.ts` | Health polling, metrics aggregation |
| Service | `src/services/vps/VpsProvisionService.ts` | Cloud-init template rendering, boot scripts |
| Webview | `webview-ui/src/components/infrastructure/` | Instance list, metrics dashboard, provision wizard |
| External | `src/services/vps/VpsApiClient.ts` | REST client to VPS provider APIs |
| Config | `config/vps/instances.yaml`, `config/vps/templates.yaml` | Per spec |
| Types | `src/services/vps/types.ts` | `VpsInstance`, `VpsTemplate`, `VpsMetrics` |

**Boundary rules:**

- VPS provisioning is asynchronous. `VpsService.create()` returns a `VpsProvisionHandle` with status polling -- the caller never blocks.
- Cloud provider credentials are resolved from `VS Code SecretStorage` or environment variables, never stored in config files.
- The webview polls instance status via postMessage requests; it never calls cloud APIs directly.
- SSH access to VPS instances is delegated to the SSH subsystem. `VpsService` produces an `SshProfile` and hands it to `SshService`.

---

### 3. ZeroClaw Execution

**Purpose:** Submit tasks for sandboxed execution through the Hermes -> ZeroClaw pipeline.

| Layer | Location | Contents |
|---|---|---|
| Extension Host | `src/commands/hermes.ts` | Command registrations (submit, cancel, status) |
| Service | `src/services/hermes/HermesPipeline.ts` | Task submission, SSE event subscription, state machine |
| Service | `src/services/hermes/HermesClient.ts` | HTTP client for Hermes Bridge API |
| Service | `src/services/hermes/HermesStatusService.ts` | Config toggle, health monitoring |
| Service | `src/services/zeroclaw/RiskClassifier.ts` | Client-side risk pre-classification |
| Service | `src/services/zeroclaw/TaskIntakeService.ts` | Envelope construction, validation |
| Webview | `webview-ui/src/components/execution/` | Task timeline, diff viewer, approval modal |
| External | `src/services/hermes/HermesClient.ts` | REST + SSE to Hermes Bridge API |
| Config | VS Code settings `kilo-code.new.hermes.*` | Per current implementation |
| Types | `src/services/hermes/types.ts` | `TaskEnvelope`, `TaskState`, `TaskStatus` |

**Boundary rules:**

- KiloCode **never** calls ZeroClaw directly. All execution requests go through Hermes via `HermesClient`.
- `HermesPipeline` owns the task state machine. The webview subscribes to state updates via postMessage; it does not drive transitions.
- API keys are resolved via `SecretStorage` with env-var fallback chain (see `services/hermes/secrets.ts`).
- The Hermes provider preset is synced into the CLI backend config via `syncHermesPreset()` in `extension.ts`. This is the only point where Hermes touches CLI backend config.

---

### 4. Provider Routing

**Purpose:** Register, health-check, and select AI providers based on capabilities, cost, and availability.

| Layer | Location | Contents |
|---|---|---|
| Extension Host | `src/commands/providers.ts` | Add/remove provider commands |
| Service | `src/services/providers/ProviderRegistry.ts` | In-memory provider registry, YAML persistence |
| Service | `src/services/providers/ProviderRouter.ts` | Capability matching, cost-aware selection |
| Service | `src/services/providers/ProviderHealthService.ts` | Periodic health checks, status tracking |
| Webview | `webview-ui/src/components/settings/ProvidersTab.tsx` | Provider list, connect dialog, model selection |
| Webview | `webview-ui/src/components/settings/ProviderConnectDialog.tsx` | Provider setup flow |
| External | `src/services/providers/ProviderApiClient.ts` | Per-provider HTTP clients with auth |
| Config | `config/providers.yaml` | Per spec |
| Types | `src/services/providers/types.ts` | `ProviderEntry`, `RoutingDecision`, `HealthStatus` |
| Existing | `src/shared/custom-provider.ts`, `src/shared/fetch-models.ts` | Current provider model code to migrate |

**Boundary rules:**

- All provider selection goes through `ProviderRouter`. No service picks a provider by hardcoded ID.
- Health checks run on a configurable interval in `ProviderHealthService`. Results are cached; callers read cache, they do not trigger checks.
- Provider credentials are stored in `SecretStorage` referenced by `authRef` in the registry. The YAML file contains only the reference key, never the secret value.
- The webview reads the provider list via postMessage. Provider mutations (add, remove, update) are commands that go through the extension host.

---

### 5. Memory / Shiba

**Purpose:** Persistent memory storage and retrieval for agent context across sessions.

| Layer | Location | Contents |
|---|---|---|
| Extension Host | `src/memory/MemoryExtension.ts` | Commands for memory search, inspect, purge |
| Service | `src/services/memory/ShibaService.ts` | WebSocket connection, write/read/search operations |
| Service | `src/services/memory/MemoryIndexService.ts` | Local index management, sync state |
| Service | `src/services/memory/ContextInjector.ts` | Injects relevant memories into agent context |
| Webview | `webview-ui/src/components/memory/` | Memory browser, search panel, context preview |
| External | `src/services/memory/ShibaClient.ts` | WebSocket client to Shiba backend |
| Config | `config/memory.yaml` | Per spec |
| Types | `src/services/memory/types.ts` | `MemoryEntry`, `ShibaConnection`, `SearchResult` |

**Boundary rules:**

- All memory operations go through `ShibaService`. No other service opens WebSocket connections to Shiba.
- `ShibaService` owns the connection lifecycle including reconnection with exponential backoff. Callers get a `Promise` -- they never see the socket.
- Memory writes from agent sessions are fire-and-forget with local queue. If Shiba is unreachable, writes are queued in a local SQLite WAL and drained on reconnect.
- The webview displays memory entries as read-only data received via postMessage. Memory mutations (purge, edit) are commands routed through the extension host.

---

### 6. Training / GPU

**Purpose:** Manage datasets, fine-tuning jobs, and GPU resource allocation.

| Layer | Location | Contents |
|---|---|---|
| Extension Host | `src/training/TrainingExtension.ts` | Commands for dataset ops, job control |
| Service | `src/services/training/DatasetService.ts` | Dataset registry, validation, preprocessing |
| Service | `src/services/training/TrainingJobService.ts` | Job submission, monitoring, artifact retrieval |
| Service | `src/services/training/GpuAllocator.ts` | GPU pool management, scheduling |
| Webview | `webview-ui/src/components/training/` | Dataset browser, job dashboard, GPU metrics |
| External | `src/services/training/TrainingApiClient.ts` | REST client to training backend |
| Config | `config/training.yaml` | Per spec |
| Types | `src/services/training/types.ts` | `DatasetEntry`, `TrainingJob`, `GpuSlot` |

**Boundary rules:**

- Dataset uploads go through `DatasetService` which validates format and size before persisting. Max upload size is enforced server-side; the client enforces it as a pre-check only.
- Training jobs are submitted via `TrainingJobService` and monitored via SSE. The webview subscribes to job status updates via postMessage.
- GPU allocation is managed by `GpuAllocator`. No service directly requests GPU resources from the cloud provider -- all requests go through the allocator which enforces quotas and scheduling.
- Large file transfers (datasets, model artifacts) use chunked upload/download. The webview shows progress but never handles raw file data.

---

### 7. Governance / Release

**Purpose:** Enforce authority tiers, audit logging, and release workflow.

| Layer | Location | Contents |
|---|---|---|
| Extension Host | `src/governance/GovernanceExtension.ts` | Commands for approvals, audit log viewer |
| Service | `src/services/governance/AuthorityService.ts` | Tier enforcement, permission checks |
| Service | `src/services/governance/AuditLogger.ts` | Append-only audit log, tamper detection |
| Service | `src/services/governance/ReleaseService.ts` | Release workflow state machine |
| Service | `src/services/governance/PolicyEngine.ts` | Policy evaluation, rule matching |
| Webview | `webview-ui/src/components/governance/` | Approval queue, audit log viewer, release dashboard |
| Config | `config/governance.yaml` | Per spec |
| Types | `src/services/governance/types.ts` | `AuthorityTier`, `AuditEntry`, `ReleaseState` |

**Boundary rules:**

- `AuthorityService.check(action, actor)` is the single enforcement point. Every state-mutating operation in every subsystem must call it before proceeding. No bypasses.
- The audit log is append-only. `AuditLogger` writes entries; nothing deletes them. The log file is integrity-checked via hash chain on startup.
- Release state transitions require the correct authority tier. `ReleaseService` calls `AuthorityService` internally -- callers do not need to check tier themselves.
- The webview displays governance data as read-only. Approval actions are postMessage commands that the extension host validates before forwarding.

---

### 8. Speech / TTS (existing)

**Purpose:** Text-to-speech for agent responses, multi-provider voice output.

| Layer | Location | Contents |
|---|---|---|
| Extension Host | Handled within `KiloProvider.ts` message dispatch | Config reads, CSP setup |
| Service | N/A (runs in webview due to audio playback constraints) | -- |
| Webview | `webview-ui/src/components/settings/SpeechTab.tsx` | Full settings UI |
| Webview | `webview-ui/src/utils/speech-playback.ts` | Playback orchestration |
| Webview | `webview-ui/src/utils/speech-providers/` | Per-provider clients (Azure, Google, OpenAI, ElevenLabs, Polly, browser) |
| Webview | `webview-ui/src/utils/speech-text-filter.ts` | Markdown/code stripping before speech |
| Config | VS Code settings `kilo-code.new.speech.*` | Provider selection, voice, rate |
| Types | `webview-ui/src/types/voice.ts` | `VoiceProvider`, `VoiceConfig`, `SpeechState` |

**Boundary rules:**

- TTS API calls are made from the webview because audio playback requires browser APIs (`AudioContext`, `<audio>`). This is the one exception to the "no external calls from webview" rule.
- All TTS endpoints must be whitelisted in CSP `connect-src` (see CSP Rules section below).
- API keys for TTS providers are stored in VS Code settings (not SecretStorage) because the webview needs direct access. This is acceptable because TTS keys are lower-sensitivity than execution keys.
- The extension host has no speech service. It supplies config and CSP; the webview owns playback.

---

## Communication Rules

### Extension Host <-> Webview

All communication uses the VS Code `postMessage` / `onMessage` API. Message types are defined in:

- `webview-ui/src/types/messages.ts` -- the canonical message type union
- `src/shared/` -- types shared between extension host and webview (imported by both sides)

```typescript
// Extension host -> Webview
provider.postMessage({ type: "action", action: "plusButtonClicked" })

// Webview -> Extension host
vscode.postMessage({ type: "submitTask", payload: { ... } })
```

Rules:
- Every message has a `type` discriminator field.
- Payloads must be JSON-serializable. No `Date` objects, no `Buffer`, no class instances.
- Large data (>100 KB) should be chunked or referenced by ID with a follow-up fetch.
- New message types must be added to the union in `messages.ts` -- no ad-hoc string types.

### Service <-> Service

Services are wired via constructor injection in `extension.ts`:

```typescript
// Good: explicit dependency
const sshService = new SshService(profileManager, transport)

// Bad: hidden singleton
import { SshService } from "./services/ssh"
SshService.getInstance() // NO
```

Rules:
- No circular imports between services. If A depends on B, B must not depend on A.
- If two services need each other, extract the shared logic into a third service or use an event emitter.
- Service constructors take `vscode.ExtensionContext` only if they need `SecretStorage` or `globalState`. Otherwise they take their dependencies explicitly.

### External API Calls

All external API calls go through dedicated client classes:

| Subsystem | Client class | Protocol |
|---|---|---|
| CLI Backend | `KiloConnectionService` | HTTP + SSE to localhost |
| Hermes | `HermesClient` | HTTP + SSE to bridge |
| Shiba | `ShibaClient` | WebSocket |
| VPS | `VpsApiClient` | HTTP to cloud provider |
| Training | `TrainingApiClient` | HTTP to training backend |
| TTS (webview) | Per-provider in `speech-providers/` | HTTP to cloud TTS APIs |

Rules:
- Every client class implements retry with exponential backoff (see `src/util/retry.ts` for the pattern).
- Every client class has a configurable timeout. Default: 30 seconds for HTTP, 10 seconds for WebSocket handshake.
- Every client class logs request/response metadata (method, URL, status, latency) to the output channel. Bodies are not logged.
- API keys are resolved at call time, not cached in the client instance.

### Configuration

All configuration is read through one of two paths:

1. **VS Code settings API** -- `vscode.workspace.getConfiguration("kilo-code.new")` for user-facing toggles.
2. **YAML loader** -- for subsystem config files under `config/`. A central `ConfigLoader` service reads, validates (Zod schema), and caches YAML files.

Rules:
- Services never read `process.env` directly for configuration. Environment variables are a resolution fallback for secrets only.
- Config changes trigger `onDidChangeConfiguration` events. Services subscribe to their own namespace.
- Config files under `config/` are validated against a Zod schema on load. Invalid config is rejected with a diagnostic, not silently ignored.

---

## File Organization Convention

### Extension host (`packages/kilo-vscode/src/`)

```
src/
  extension.ts                    # Activation, wiring, command registration
  constants.ts                    # Extension-wide constants
  KiloProvider.ts                 # Main webview provider
  AgentManagerProvider.ts         # Agent manager panel (in agent-manager/)
  SettingsEditorProvider.ts       # Settings/profile editor
  DiffViewerProvider.ts           # Diff viewer panel
  SubAgentViewerProvider.ts       # Sub-agent viewer

  commands/                       # Command handlers (one file per command group)
    hermes.ts
    toggle-auto-approve.ts
    providers.ts                  # NEW: provider management commands
    ssh.ts                        # NEW: SSH commands
    vps.ts                        # NEW: VPS commands
    training.ts                   # NEW: training commands
    governance.ts                 # NEW: governance commands
    memory.ts                     # NEW: memory commands

  services/                       # Business logic (one directory per subsystem)
    cli-backend/                  # CLI backend connection
      connection-service.ts
      server-manager.ts
      sdk-sse-adapter.ts
      types.ts
      index.ts
    hermes/                       # Hermes pipeline (EXISTING)
      HermesClient.ts
      HermesPipeline.ts
      HermesStatusService.ts
      HermesProviderPreset.ts
      secrets.ts
      types.ts
      index.ts
    ssh/                          # NEW
      SshService.ts
      SshProfileManager.ts
      SftpService.ts
      SshTransport.ts
      types.ts
      index.ts
    vps/                          # NEW
      VpsService.ts
      VpsMonitor.ts
      VpsProvisionService.ts
      VpsApiClient.ts
      types.ts
      index.ts
    providers/                    # NEW
      ProviderRegistry.ts
      ProviderRouter.ts
      ProviderHealthService.ts
      ProviderApiClient.ts
      types.ts
      index.ts
    memory/                       # NEW
      ShibaService.ts
      ShibaClient.ts
      MemoryIndexService.ts
      ContextInjector.ts
      types.ts
      index.ts
    training/                     # NEW
      DatasetService.ts
      TrainingJobService.ts
      GpuAllocator.ts
      TrainingApiClient.ts
      types.ts
      index.ts
    governance/                   # NEW
      AuthorityService.ts
      AuditLogger.ts
      ReleaseService.ts
      PolicyEngine.ts
      types.ts
      index.ts
    autocomplete/                 # EXISTING
    browser-automation/           # EXISTING
    code-actions/                 # EXISTING
    commit-message/               # EXISTING
    marketplace/                  # EXISTING
    telemetry/                    # EXISTING

  agent-manager/                  # Agent Manager subsystem (EXISTING)
  kilo-provider/                  # KiloProvider helpers (EXISTING)
  shared/                         # Types shared with webview
  util/                           # Pure utility functions
  legacy-migration/               # Migration helpers
  test/                           # Extension host tests
```

### Webview (`packages/kilo-vscode/webview-ui/src/`)

```
webview-ui/src/
  App.tsx                         # Root component
  index.tsx                       # Entry point

  components/
    chat/                         # Chat UI (EXISTING)
    settings/                     # Settings panels (EXISTING, extend for new subsystems)
    history/                      # History view (EXISTING)
    marketplace/                  # Marketplace browser (EXISTING)
    profile/                      # Profile manager (EXISTING)
    shared/                       # Shared UI components (EXISTING)
    migration/                    # Migration UI (EXISTING)
    remote/                       # NEW: SSH terminal, SFTP browser, connection status
    infrastructure/               # NEW: VPS instance list, metrics, provision wizard
    execution/                    # NEW: ZeroClaw task timeline, diff, approval
    memory/                       # NEW: memory browser, search, context preview
    training/                     # NEW: dataset browser, job dashboard, GPU metrics
    governance/                   # NEW: approval queue, audit log, release dashboard

  context/                        # Solid.js context providers
  hooks/                          # Solid.js hooks
  types/                          # TypeScript type definitions
    messages.ts                   # postMessage type union (canonical)
    voice.ts                      # Speech types
    marketplace.ts                # Marketplace types
  utils/                          # Pure utility functions
    speech-providers/             # TTS provider clients
    timeline/                     # Timeline rendering utils
  data/                           # Static data, fixtures
  i18n/                           # Internationalization
  styles/                         # CSS/style files
  stories/                        # Storybook stories
```

### Configuration (`config/`)

```
config/
  ssh/
    profiles.yaml
    groups.yaml
  vps/
    instances.yaml
    templates.yaml
  providers.yaml
  memory.yaml
  training.yaml
  governance.yaml
```

### Naming conventions

| Item | Convention | Example |
|---|---|---|
| Service class | PascalCase, suffix `Service` | `SshService`, `VpsMonitor` (monitor is allowed) |
| Client class | PascalCase, suffix `Client` or `ApiClient` | `HermesClient`, `VpsApiClient` |
| Types file | `types.ts` in subsystem directory | `services/ssh/types.ts` |
| Barrel export | `index.ts` in subsystem directory | `services/ssh/index.ts` |
| Config file | kebab-case YAML | `providers.yaml`, `memory.yaml` |
| Command handler | kebab-case TS file | `commands/toggle-auto-approve.ts` |
| Webview component | PascalCase TSX | `SshTerminal.tsx`, `VpsMetrics.tsx` |
| Test file | `*.test.ts` co-located or in `__tests__/` | `SshService.test.ts` |

---

## CSP Rules

The webview Content Security Policy is built in `src/webview-html-utils.ts`.
Every external endpoint that the webview connects to must be listed in `connect-src`.

### Current CSP connect-src allowlist

```
http://127.0.0.1:*              # CLI backend (localhost)
http://localhost:*               # CLI backend (localhost alias)
ws://127.0.0.1:*                # CLI backend WebSocket
ws://localhost:*                 # CLI backend WebSocket alias
https://*.tts.speech.microsoft.com   # Azure TTS
https://texttospeech.googleapis.com  # Google TTS
https://api.openai.com               # OpenAI TTS
https://api.elevenlabs.io            # ElevenLabs TTS
https://polly.*.amazonaws.com        # AWS Polly TTS
```

### CSP additions required per subsystem

| Subsystem | Endpoints to add | Reason |
|---|---|---|
| SSH | None | SSH runs in extension host (Node.js), not webview |
| VPS | None | VPS API calls run in extension host, not webview |
| ZeroClaw | None | Hermes calls run in extension host via `HermesClient` |
| Provider Routing | Provider health-check URLs (dynamic) | Only if health status badges are rendered in webview. Prefer proxying through extension host |
| Memory / Shiba | `wss://shiba.kilocode.internal` | Only if webview needs direct Shiba access. Prefer proxying through extension host |
| Training | None | Training API calls run in extension host |
| Governance | None | Governance calls run in extension host |

**Guidance:** Avoid adding new external endpoints to CSP. The extension host should proxy data to
the webview via postMessage. Direct webview-to-external connections are only justified when the
browser must handle the response directly (e.g., audio streaming for TTS, or WebSocket streams
that would be impractical to relay through postMessage).

If a new endpoint must be added:
1. Add it to `buildCspString()` in `src/webview-html-utils.ts`.
2. Document it in this table.
3. Use the most restrictive pattern possible (specific host, not `https://*`).

---

## Dependency Graph (prohibited edges)

The following import paths are **forbidden**. If you need them, your design is wrong -- restructure.

```
FORBIDDEN:
  webview-ui/** -> src/**                    # Webview cannot import extension host code
  src/services/A/** -> src/services/B/**     # where B also imports from A (circular)
  src/services/** -> src/KiloProvider.ts     # Services must not depend on the webview host
  src/services/** -> src/extension.ts        # Services must not depend on activation
  src/commands/** -> src/services/*/internal  # Commands call public API only
  webview-ui/** -> node_modules/vscode       # Webview has no VS Code API access
  src/services/hermes/** -> zeroclaw-internal-api  # KiloCode never calls ZeroClaw directly
```

To verify: run `madge --circular src/` or use the import linter in CI.

---

## Testing Boundaries

Each subsystem owns its own tests. Tests must not cross subsystem boundaries.

| Test type | Location | What it tests |
|---|---|---|
| Unit tests | `src/services/<subsystem>/__tests__/` | Individual service methods, mocked dependencies |
| Integration tests | `src/test/integration/<subsystem>/` | Service-to-service interaction within the subsystem |
| Webview unit tests | `webview-ui/src/components/<subsystem>/__tests__/` | Component rendering, user interaction |
| E2E tests | `test/e2e/<subsystem>/` | Full flow from command to webview assertion |

Rules:
- Unit tests mock all external dependencies (API clients, VS Code API, file system).
- Integration tests may use real file I/O and localhost servers but not real cloud APIs.
- Tests must not depend on global state. Each test sets up and tears down its own fixtures.
- Subsystem A's tests must not import subsystem B's internal modules. If testing cross-subsystem behavior, write an integration test that uses both subsystems' public APIs.
