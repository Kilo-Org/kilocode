# Execution Substrate Requirements

Date: 2026-04-17
Version: 1.0.0
Status: Draft
Phase: 16 of 72-phase plan

---

## 1. Execution Substrates

Every piece of KiloCode work runs on exactly one of these substrates. No operation floats between substrates -- the mapping is deterministic.

| Substrate | Description | Managed By | Location | Cost Model |
|-----------|-------------|-----------|----------|------------|
| VS Code Extension Host | Node.js process inside VS Code. Has full VS Code API access, filesystem access, and can spawn child processes. Single-threaded event loop. | VS Code | Local | Free |
| VS Code Webview | Chromium-based browser sandbox inside VS Code. DOM rendering, Web Audio API, fetch (CSP-scoped). No Node.js, no VS Code API, no filesystem. | VS Code | Local | Free |
| CLI Backend | Kilo CLI server process (`opencode server`). Spawned as a child process by the extension host. Exposes REST + SSE on localhost. Owns the SDK client for provider communication. | KiloCode Extension Host | Local | Free |
| Hermes Bridge | Mission control server. Receives task envelopes, evaluates policy, routes to ZeroClaw, writes memory via Shiba, maintains the ledger. | Hermes Operator | Local or Remote | Infrastructure-dependent |
| ZeroClaw Sandbox | Hardened container with network namespace, overlayfs, resource cgroups, and policy enforcement. Created per-job by Hermes. Destroyed after execution + retention window. | Hermes | Local or Remote | Variable (compute time) |
| Shiba Backend | Persistent memory service. WebSocket API for write/read/search/batch operations. Stores memory entries with project scoping and TTL. | Shiba Operator | Remote | Infrastructure-dependent |
| Local GPU | NVIDIA GPU on the developer machine. Detected via `nvidia-smi`. Used for training jobs when VRAM is sufficient. | Developer | Local | Free (electricity) |
| Remote GPU (RunPod) | Rented GPU instance. A100-80GB at $1.99/hr, H100-80GB at $3.49/hr, RTX-4090 at $0.69/hr. API-provisioned. | RunPod API | Cloud | $0.69-$3.49/hr |
| Remote GPU (Lambda) | Rented GPU instance. A100-80GB at $1.29/hr, H100-80GB at $2.49/hr. API-provisioned. | Lambda API | Cloud | $1.29-$2.49/hr |
| Remote GPU (Vast.ai) | Community GPU marketplace. RTX-4090 at $0.40/hr, A100-40GB at $0.80/hr. API-provisioned. | Vast.ai API | Cloud | $0.40-$0.80/hr |
| SSH Remote Host | Developer-owned servers or VPS instances accessed via SSH. Runs commands, hosts terminals, serves files via SFTP. | SSH Service (Extension Host) | Remote | Developer-owned |
| Docker on Remote | Containers on developer VPS, managed via Docker Engine socket tunneled over SSH. | Docker Engine via SSH | Remote | Developer-owned |
| Local Inference Server | Ollama (`localhost:11434`) or LM Studio (`localhost:1234`). Runs local LLMs for private-data and local-dev tasks. Single concurrent request constraint. | Developer | Local | Free (electricity) |
| CI/CD Runner | GitHub Actions runner (or equivalent). Executes lint, test, build, package, stage, release, monitor pipeline stages. | CI/CD Platform (GitHub) | Cloud | Variable (minutes-based) |
| TTS Cloud Endpoints | Azure Cognitive Services, Google Cloud TTS, OpenAI TTS, ElevenLabs, Amazon Polly. Called directly from the webview for audio synthesis. | Cloud Provider | Cloud | Free tier + pay-per-character |

---

## 2. Subsystem to Substrate Mapping

### 2.1 SSH / Remote Systems

| Operation | Runs On | Why | Protocol |
|-----------|---------|-----|----------|
| SSH connection management | Extension Host | Requires `ssh2` library (Node.js native addon), persistent TCP socket, keep-alive timer | TCP via ssh2 |
| SSH profile CRUD | Extension Host | Filesystem access for `config/ssh/profiles.yaml`, VS Code SecretStorage for passphrases | Local filesystem |
| SSH key resolution | Extension Host | Reads private key files from disk, resolves `secret://` URIs via VS Code SecretStorage | Local filesystem |
| Jump host chaining | Extension Host | Opens nested SSH channels through bastion hosts; requires socket-level control | TCP via ssh2 |
| Terminal PTY allocation | Extension Host -> SSH Remote Host | Allocates PTY on remote via SSH channel, streams stdin/stdout over the connection | SSH channel |
| Terminal rendering | Webview | DOM-based terminal emulation via xterm.js; requires browser rendering engine | postMessage from Extension Host |
| Terminal resize events | Webview -> Extension Host -> SSH Remote Host | Webview detects container resize, posts new cols/rows, Extension Host sends PTY window change | postMessage + SSH |
| SFTP file listing | Extension Host -> SSH Remote Host | Direct SFTP subsystem access over SSH channel; returns serializable entries via postMessage | SSH SFTP subsystem |
| SFTP file read/write | Extension Host -> SSH Remote Host | Streams file bytes over SFTP channel; large files chunked; webview shows progress via postMessage | SSH SFTP subsystem |
| SFTP directory operations | Extension Host -> SSH Remote Host | mkdir, rmdir, rename, chmod -- all executed on remote via SFTP subsystem | SSH SFTP subsystem |
| Connection state display | Webview | Renders connection badge (connected/reconnecting/disconnected) from postMessage state updates | postMessage |
| Connection status bar | Extension Host | VS Code status bar item showing connection count; requires VS Code API | VS Code API |
| Reconnection logic | Extension Host | Exponential backoff (2s, 4s, 8s, 16s, cap 30s), max 5 attempts; requires timer management in Node.js | Internal |
| Group management | Extension Host | YAML read/write for `config/ssh/groups.yaml`; validation against profile references | Local filesystem |

### 2.2 VPS / Infrastructure

| Operation | Runs On | Why | Protocol |
|-----------|---------|-----|----------|
| VPS inventory display | Webview | Renders instance list with status badges, metrics dashboard, provision wizard | postMessage |
| VPS inventory data fetch | Extension Host | Calls `VpsApiClient` to query cloud provider APIs; results relayed to webview via postMessage | HTTPS to cloud APIs |
| Instance provisioning | Extension Host | Calls cloud provider API to create instance; returns `VpsProvisionHandle` for async status polling | HTTPS to cloud APIs |
| Cloud-init rendering | Extension Host | Renders boot script templates from `config/vps/templates.yaml`; string templating, no network | Local filesystem |
| Service control commands | Extension Host -> SSH Remote Host | `systemctl`, `docker`, etc. executed on remote via SSH channel; delegated to SSH subsystem | SSH channel |
| Docker API calls | Extension Host -> SSH Remote Host | Docker socket access tunneled over SSH; commands like `docker ps`, `docker logs` | SSH tunnel to Docker socket |
| Health polling | Extension Host -> SSH Remote Host | Periodic SSH commands (`uptime`, `free`, `df`) to collect OS metrics; results cached in `VpsMonitor` | SSH channel |
| Metrics visualization | Webview | Charts rendered from metrics data received via postMessage; no direct remote access | postMessage |
| Instance resize/destroy | Extension Host | Cloud provider API calls; asynchronous with status polling | HTTPS to cloud APIs |
| SSH profile handoff | Extension Host | `VpsService` creates an `SshProfile` and passes it to `SshService`; no cross-subsystem import | Internal service call |

### 2.3 ZeroClaw Execution

| Operation | Runs On | Why | Protocol |
|-----------|---------|-----|----------|
| Task intake and envelope construction | Extension Host | Builds `TaskEnvelope` from user intent + workspace context; requires VS Code API for workspace paths | Internal |
| Risk pre-classification | Extension Host | Applies classification table (task_type x scope) and escalation rules; lightweight logic, no network | Internal |
| Task submission | Extension Host -> Hermes Bridge | `POST /tasks` to Hermes Bridge API via `HermesClient`; includes envelope with risk_level, constraints | HTTPS (or HTTP to localhost) |
| SSE event subscription | Extension Host | `GET /tasks/{id}/events` SSE stream from Hermes; Extension Host processes state transitions | SSE over HTTP(S) |
| Policy evaluation | Hermes Bridge | Hermes validates envelope, may escalate risk_level; never downgrade; checks approval_chain | Internal to Hermes |
| Approval state machine | Extension Host + Hermes Bridge | Hermes emits `awaiting_approval` state; Extension Host shows approval UI; user action posts `POST /tasks/{id}/approve` | HTTPS + postMessage |
| Approval modal rendering | Webview | Modal showing task description, risk level, signer list; user clicks approve/deny | postMessage |
| Job creation and dispatch | Hermes Bridge -> ZeroClaw Sandbox | Hermes creates ZeroClaw job with workspace mounts, network policy, resource limits; KiloCode never sees this | Internal Bridge B API |
| Sandboxed execution | ZeroClaw Sandbox | Container with dedicated network namespace, cgroups, overlayfs; runs shell/script/compose commands | Container runtime |
| Workspace isolation | ZeroClaw Sandbox | Mount rules enforced: project path (ro or rw per write_mode), scratch dir, no system paths | overlayfs + mount namespaces |
| Network policy enforcement | ZeroClaw Sandbox | iptables rules in per-job network namespace; none/limited/full policies | iptables in network namespace |
| Secret masking | ZeroClaw Sandbox | Scans mounted files and stdout/stderr for API key / token patterns; replaces with `[REDACTED]` | Regex in container |
| Diff generation (buffered writes) | ZeroClaw Sandbox | Writes redirected to scratch dir; unified diff computed against original | Container filesystem |
| Diff rendering | Webview | Syntax-highlighted diff panel with per-file breakdown; shown during `awaiting_approval` state | postMessage |
| Artifact collection | ZeroClaw Sandbox -> Hermes Bridge | Files, logs, diffs, reports returned to Hermes with checksums | Internal Bridge B response |
| Artifact retrieval | Extension Host -> Hermes Bridge | `GET /tasks/{id}` returns `artifacts_url`; Extension Host fetches and relays to webview | HTTPS |
| Artifact display | Webview | Artifact panel (files), logs panel (scrollable/searchable), report cards in timeline | postMessage |
| Pre-execution snapshot | ZeroClaw Sandbox | tar archive of workspace scope paths; stored as `snapshot/{job_id}/pre.tar.gz`; max 500 MB | Container filesystem |
| Rollback execution | ZeroClaw Sandbox | Restores files from snapshot, verifies checksums, kills orphan processes | Container filesystem |
| Rollback UI | Webview | "Rollback" button in execution timeline; triggers `POST /tasks/{id}/rollback` via Extension Host | postMessage + HTTPS |
| Task status display | Webview | Execution timeline with real-time state updates (queued -> executing -> completed/failed) | postMessage (from SSE relay) |
| Ledger writes | Hermes Bridge | Hermes writes task outcome, approvals, rollback records to append-only ledger | Internal to Hermes |
| Error display | Webview | ZeroClaw error codes (`ZC_TIMEOUT`, `ZC_POLICY_VIOLATION`, etc.) shown as notifications with user-facing messages | postMessage |

### 2.4 Provider Routing

| Operation | Runs On | Why | Protocol |
|-----------|---------|-----|----------|
| Provider registry load | Extension Host | Reads `config/providers.yaml`, validates against Zod schema, caches in `ProviderRegistry` | Local filesystem |
| Provider registry mutation | Extension Host | Add/remove/update provider entries; writes YAML; credentials stored in VS Code SecretStorage | Local filesystem + SecretStorage |
| Routing decision | Extension Host | `ProviderRouter` applies 8-step algorithm: filter by sensitivity, task_type, context_tokens, availability, budget; rank by priority + cost | Internal |
| Data sensitivity enforcement | Extension Host | `restricted`/`confidential` data hard-blocked from cloud providers; only `type: local` allowed | Internal |
| Health check execution | Extension Host | Periodic HTTP pings to each provider's `healthCheckUrl`; results cached in `ProviderHealthService` | HTTPS (cloud) or HTTP (local) |
| Health status display | Webview | Provider list with status badges (healthy/degraded/offline); received via postMessage | postMessage |
| Provider connect dialog | Webview | UI for adding new provider: endpoint, auth method, capabilities selection | postMessage |
| API key resolution | Extension Host | Resolved at call time from VS Code SecretStorage with env-var fallback; never cached in client instance | SecretStorage + env |
| Rate limit tracking | Extension Host | Per-provider counters for requests/minute and tokens/minute; sliding window; queue requests that would exceed limits | Internal |
| Cost tracking | Extension Host | Per-request cost estimate computed from token counts and provider cost model; accumulated into session budget | Internal |
| Fallback chain execution | Extension Host | On provider failure (HTTP 5xx, timeout, rate limit), try next provider in fallback chain (max depth 3) | HTTPS |
| API calls to cloud providers | Extension Host -> CLI Backend | Actual LLM API calls routed through CLI Backend (`opencode server`) which owns the SDK client | HTTP to localhost (CLI Backend) -> HTTPS to provider |
| Local inference calls | Extension Host -> Local Inference Server | Ollama (`localhost:11434/api/chat`) or LM Studio (`localhost:1234/v1/chat/completions`); no auth | HTTP to localhost |
| Provider settings UI | Webview | Provider list, model selection, connect dialog in `ProvidersTab.tsx` | postMessage |

### 2.5 Memory / Shiba

| Operation | Runs On | Why | Protocol |
|-----------|---------|-----|----------|
| Shiba connection management | Extension Host | `ShibaClient` maintains persistent WebSocket; reconnection with exponential backoff (1s -> 30s, max 10 retries) | WSS to Shiba Backend |
| Memory write | Extension Host | `ShibaService.write()` sends `MemoryWriteRequest` over WebSocket; fire-and-forget with local queue fallback | WSS |
| Memory read/recall | Extension Host | `ShibaService.recall()` sends `RecallRequest` over WebSocket; returns `RecallResponse` with relevance scores | WSS |
| Write queueing (offline) | Extension Host | When Shiba is unreachable, writes queued in local SQLite WAL (`data/memory/queue.sqlite`); drained FIFO on reconnect | Local SQLite |
| Dead letter handling | Extension Host | Writes exceeding 5 retries moved to `data/memory/dead_letter.jsonl`; emits `MEM_WRITE_FAILED` | Local filesystem |
| Context injection | Extension Host | `ContextInjector` queries relevant memories and injects into agent context before LLM calls | Internal |
| Local index management | Extension Host | `MemoryIndexService` maintains local index for fast key lookups; synced with Shiba on connect | Internal |
| Memory browser display | Webview | Read-only list of memory entries with search, filtering by scope/tags; data received via postMessage | postMessage |
| Memory search UI | Webview | Search panel with query input, scope selector, relevance threshold slider | postMessage |
| Memory purge/edit | Extension Host | Destructive operations routed through Extension Host commands; webview posts command, Extension Host validates and forwards to Shiba | postMessage + WSS |
| Auth token management | Extension Host | JWT from `SHIBA_AUTH_TOKEN` env; refreshed 300s before expiry | Environment variable |
| Ping/pong health | Extension Host | 15s ping interval, 5s pong timeout; missed pongs trigger reconnection | WSS |
| Batch operations | Extension Host | Bulk write/read with 15s timeout; used for session end memory flush | WSS |

### 2.6 Training / GPU

| Operation | Runs On | Why | Protocol |
|-----------|---------|-----|----------|
| Dataset registration | Extension Host | `DatasetService` validates format (JSONL/CSV/Parquet/HF), checks size limit (10 GB max), writes to `data/datasets/` | Local filesystem |
| Dataset validation pipeline | CLI Backend or ZeroClaw Sandbox | CPU-intensive 6-stage pipeline (schema check, dedup, null scan, normalization, split, summary); may need disk for large datasets | Local process or container |
| Dataset preprocessing | CLI Backend or ZeroClaw Sandbox | Row dedup, whitespace normalization, Unicode NFC, date standardization; modifies files in place or buffered | Local process or container |
| Training job submission | Extension Host | `TrainingJobService` creates `TrainingJob`, selects GPU target via `GpuAllocator`, dispatches to training backend | HTTP to training backend |
| Local GPU detection | Extension Host | Runs `nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader`; parses output | Child process (shell) |
| CUDA version detection | Extension Host | Runs `nvcc --version`; parses release line | Child process (shell) |
| VRAM estimation | Extension Host | Calculates required VRAM: full fine-tune = params_B * 18 GB, LoRA = params_B * 2 GB + 500 MB, QLoRA = params_B * 0.5 GB + 500 MB | Internal |
| GPU auto-selection | Extension Host | Checks local GPU first (free); if insufficient, queries remote providers, filters by VRAM, sorts by cost ascending | HTTP to remote GPU APIs |
| Model training (LoRA/QLoRA) | Local GPU or Remote GPU | GPU-intensive; loads base model + adapter; requires CUDA, PyTorch, VRAM per estimation formula | CUDA / PyTorch |
| Model training (full fine-tune) | Local GPU or Remote GPU | Most GPU-intensive; loads full model + optimizer + gradients; typically requires 24+ GB VRAM | CUDA / PyTorch |
| Training monitoring events | Local GPU or Remote GPU -> Extension Host | `MonitoringEvent` emitted every N steps (loss, val_loss, GPU utilization, throughput); streamed to Extension Host | WebSocket or SSE |
| TensorBoard logging | Local GPU or Remote GPU | Writes TensorBoard event files to `data/training/tensorboard/{job_id}/` | Local filesystem on training host |
| Checkpoint saving | Local GPU or Remote GPU | Saves adapter weights, optimizer state, scheduler state, RNG state every N steps; SHA-256 checksum per checkpoint | Local filesystem on training host |
| Checkpoint management | Extension Host | Lists, verifies, deletes checkpoints; file system operations on training host (local or via SSH for remote) | Local filesystem or SSH |
| Training job monitoring UI | Webview | Loss curves, GPU metrics, progress bar, ETA display; data received via postMessage | postMessage |
| Run comparison | Extension Host | `RunComparison` computes across multiple completed jobs; CPU-only metric aggregation and chart data generation | Internal |
| Run comparison display | Webview | Overlaid loss curves, hyperparameter comparison table, best-run recommendation | postMessage |
| Model export (GGUF/safetensors/ONNX) | CLI Backend | CPU-intensive: merge adapter with base model, apply quantization (q4_0, q4_k_m, q5_k_m, q8_0, f16, f32), convert format | Local process |
| Export progress display | Webview | Progress bar for export steps (merge, quantize, convert, write) | postMessage |
| Remote GPU provisioning | Extension Host | API calls to RunPod/Lambda/Vast.ai to create GPU instance; returns instance handle for monitoring | HTTPS to GPU provider APIs |
| Remote GPU teardown | Extension Host | API calls to terminate rented instance after training completes or fails | HTTPS to GPU provider APIs |
| Early stopping evaluation | Local GPU or Remote GPU | Checks val_loss improvement against patience (3 epochs) and min_delta (0.001); halts training if triggered | Internal to training process |
| Resume from checkpoint | Local GPU or Remote GPU | Loads checkpoint, verifies checksum, restores model + optimizer + scheduler + RNG state; continues from saved step | CUDA / PyTorch |
| Dataset browser UI | Webview | Dataset list with validation status, column defs, sample values, split statistics | postMessage |

### 2.7 Governance / Release

| Operation | Runs On | Why | Protocol |
|-----------|---------|-----|----------|
| Authority tier enforcement | Extension Host | `AuthorityService.check(action, actor)` is the single enforcement point; called by every state-mutating operation before proceeding | Internal |
| Permission checks | Extension Host | Validates actor roles against required tier for the action; returns allow/deny | Internal |
| Approval request creation | Extension Host | Creates `ApprovalRequest` with required approvers, expiry, evidence requirements | Internal |
| Approval notification | Extension Host | Notifies required approvers via configured channel; tracks pending approvals | Internal + notification channel |
| Approval decision handling | Extension Host | Processes approve/deny from each signer; checks if all required approvers have responded | Internal |
| Approval UI | Webview | Approval queue showing pending requests with action description, risk level, evidence links | postMessage |
| Audit logging | Extension Host | `AuditLogger` appends records to `data/governance/audit/YYYY-MM-DD.jsonl`; append-only, hash-chain integrity | Local filesystem |
| Audit log integrity check | Extension Host | On startup, verifies SHA-256 hash chain in `data/governance/audit/checksums.jsonl` | Local filesystem |
| Audit log viewer | Webview | Searchable/filterable log display; queries by actor, action, result, tier, date range, risk_level | postMessage |
| Dangerous action registry | Extension Host | Loads `config/governance.yaml` dangerous_actions; evaluates deny_conditions and gate_conditions before allowing action | Local filesystem |
| Gate condition evaluation | Extension Host | Checks expressions like `test_suite.pass_rate < 0.95` or `ci_pipeline.all_stages_passed == true` against current state | Internal |
| Release state machine | Extension Host | `ReleaseService` manages release workflow: initiate -> checklist -> approve -> publish -> monitor | Internal |
| Release checklist evaluation | Extension Host | Iterates `ChecklistItem[]`; verifies each required item has status `passed` with evidence | Internal |
| Release dashboard | Webview | Checklist progress, pipeline status, approval status; data via postMessage | postMessage |
| CI/CD pipeline trigger | Extension Host -> CI/CD Runner | Triggers GitHub Actions workflow via API; monitors pipeline stages (lint, test, build, package, stage, release, monitor) | HTTPS to GitHub API |
| CI/CD stage execution | CI/CD Runner | Each stage runs on GitHub Actions runner: ESLint, vitest, tsc, esbuild/vite, VSIX packaging, smoke tests | GitHub Actions runner |
| CI/CD artifact collection | CI/CD Runner -> Extension Host | Pipeline produces artifacts (VSIX, test reports, coverage reports); Extension Host fetches via API | HTTPS to GitHub API |
| CI/CD status display | Webview | Pipeline stages with pass/fail badges, gate results, artifact links | postMessage |
| VSIX publishing | CI/CD Runner | `vsce publish` to VS Code Marketplace; requires Tier 3 approval | GitHub Actions runner |
| Rollback initiation | Extension Host | Creates `RollbackRequest`; if not emergency, creates Tier 3 ApprovalRequest | Internal |
| Rollback execution | CI/CD Runner | Halts deployments, reverts to target version artifacts, runs verification smoke tests | GitHub Actions runner |
| Post-release monitoring | Extension Host | 30-minute window: watches error rates, crash reports; triggers rollback if thresholds exceeded | HTTPS to monitoring endpoints |
| Emergency override | Extension Host | Single operator can initiate rollback with `emergency: true`; bypasses Tier 3 but requires post-hoc audit within 24 hours | Internal |

### 2.8 Speech / TTS (existing, complete)

| Operation | Runs On | Why | Protocol |
|-----------|---------|-----|----------|
| TTS API calls (Azure) | Webview | Audio playback requires Web Audio API / `<audio>` element; browser sandbox is the only substrate with audio output | HTTPS to `*.tts.speech.microsoft.com` |
| TTS API calls (Google) | Webview | Same: browser audio constraint | HTTPS to `texttospeech.googleapis.com` |
| TTS API calls (OpenAI) | Webview | Same: browser audio constraint | HTTPS to `api.openai.com` |
| TTS API calls (ElevenLabs) | Webview | Same: browser audio constraint | HTTPS to `api.elevenlabs.io` |
| TTS API calls (Polly) | Webview | Same: browser audio constraint | HTTPS to `polly.*.amazonaws.com` |
| Browser TTS (Web Speech API) | Webview | Native browser API; no network call; works offline | Web Speech API (local) |
| Audio playback | Webview | Web Audio API + `AudioContext`; browser sandbox is the only substrate that can play audio | Web Audio API |
| LRU synthesis cache | Webview | In-memory cache of 32 audio blobs; avoids redundant API calls for repeated text | In-memory (browser) |
| Text filtering (25 rules) | Webview | Regex-based stripping of markdown, code blocks, URLs before speech synthesis; lightweight, no network | Internal (browser) |
| Sentiment detection | Webview | Analyzes text tone; adjusts pitch/rate dynamically based on sentiment intensity setting | Internal (browser) |
| Auto-speak trigger | Webview | Fires when agent response completes; checks `autoSpeak` and `interactionMode` settings | Internal (browser) |
| Stop-on-typing | Webview | Interrupts playback when user begins typing; listens for input events | DOM event listener |
| Speech settings UI | Webview | `SpeechTab.tsx` renders provider selection, voice tuning, favorites, presets | Solid.js component |
| Speech config read | Extension Host | Reads VS Code settings `kilo-code.new.speech.*`; supplies to webview via postMessage | VS Code Settings API |
| CSP construction | Extension Host | Builds Content-Security-Policy with TTS endpoint allowlist in `connect-src` | Internal |
| Connection test | Webview | `testConnection(apiKey, region)` pings provider endpoint to verify credentials | HTTPS to provider |

### 2.9 Core / Existing

| Operation | Runs On | Why | Protocol |
|-----------|---------|-----|----------|
| Extension activation | Extension Host | `extension.ts` runs on VS Code startup; wires all services, registers commands | VS Code API |
| Command registration | Extension Host | `vscode.commands.registerCommand()`; one file per command group under `src/commands/` | VS Code API |
| Webview HTML construction | Extension Host | Builds HTML shell with CSP, script tags, nonces; served to webview | VS Code Webview API |
| postMessage dispatch | Extension Host | `KiloProvider` handles incoming messages from webview, dispatches to services, sends responses | postMessage |
| CLI Backend spawn | Extension Host | Starts `opencode server` as child process; manages lifecycle, port allocation | Child process |
| CLI Backend communication | Extension Host | `KiloConnectionService` sends HTTP requests and subscribes to SSE on localhost | HTTP + SSE to localhost |
| Agent session management | Extension Host | `AgentManagerProvider` manages worktrees, git operations, terminal sessions | VS Code API + Git |
| Git operations | Extension Host | `GitOps` runs git commands via child process; diff, status, log, worktree management | Child process (git CLI) |
| Git stats polling | Extension Host | `GitStatsPoller` periodically runs `git diff --stat`; results sent to webview for diff badge | Child process (git CLI) |
| Sidebar UI rendering | Webview | Main chat interface, settings panels, history, marketplace browser | Solid.js |
| Diff viewer | Webview | `DiffViewerProvider` renders code diffs with syntax highlighting | VS Code Webview API |
| Autocomplete | Extension Host | `services/autocomplete/` provides inline completions via VS Code API | VS Code API + CLI Backend |
| Browser automation | Extension Host | `services/browser-automation/` controls browser for testing/scraping | Puppeteer/Playwright |
| Telemetry | Extension Host | `services/telemetry/` collects usage metrics; sends to telemetry endpoint | HTTPS |
| Marketplace | Extension Host + Webview | Extension Host fetches marketplace data; Webview renders browser UI | HTTPS + postMessage |
| Settings editor | Extension Host + Webview | `SettingsEditorProvider` manages settings panel in separate webview | VS Code Webview API |

---

## 3. Resource Requirements

### 3.1 Minimum Resources per Substrate

| Substrate | Min CPU | Min RAM | GPU | Disk | Network | Concurrency |
|-----------|---------|---------|-----|------|---------|-------------|
| Extension Host | 1 core | 256 MB | No | 50 MB (extension bundle) | localhost + internet | Single-threaded event loop |
| Webview | 1 core | 128 MB | No | 10 MB (bundled JS/CSS) | CSP-scoped fetch | Single-threaded (UI thread) |
| CLI Backend | 2 cores | 512 MB | No | 100 MB (server + SDK) | localhost (server) + internet (providers) | Multi-connection (HTTP server) |
| Hermes Bridge | 2 cores | 1 GB | No | 500 MB (ledger + task state) | Internet (inbound from KiloCode, outbound to ZeroClaw) | Multi-tenant |
| ZeroClaw Sandbox | 0.5-8 cores | 256 MB - 16 GB | Optional | 100 MB - 10 GB scratch | Policy-scoped (none/limited/full) | One process tree per job |
| Shiba Backend | 2 cores | 2 GB | No | 1 GB (memory store) | WSS (inbound from KiloCode) | Multi-tenant |
| Local GPU (Training) | 4 cores | 16 GB system RAM | 8+ GB VRAM | 50 GB (datasets + checkpoints + models) | localhost (monitoring) | 1 training job at a time |
| Remote GPU (Training) | 8 cores | 32 GB system RAM | 24+ GB VRAM | 100 GB (datasets + checkpoints + exports) | Internet (SSH + monitoring) | 1 training job per instance |
| SSH Remote Host | N/A (developer-owned) | N/A | N/A | N/A | SSH (port 22) | Max 4 concurrent SFTP ops per connection |
| Docker on Remote | 1 core | 512 MB (Docker Engine) | No | Variable | SSH tunnel to Docker socket | Multiple containers |
| Local Inference Server | 2 cores | 8 GB system RAM | 4+ GB VRAM (Ollama) | 10 GB (model files) | localhost only | 1 concurrent request (GPU constraint) |
| CI/CD Runner | 2 cores | 4 GB | No | 10 GB (build artifacts) | Internet | Per-workflow |
| TTS Cloud Endpoints | N/A (cloud) | N/A | N/A | N/A | HTTPS | Rate-limited per provider |

### 3.2 ZeroClaw Resource Limits by Risk Level

From the ZeroClaw spec, per-job cgroup limits:

| Risk Level | CPU (cores) | Memory (MB) | Timeout (s) | Disk (MB) |
|------------|-------------|-------------|-------------|-----------|
| low | 0.5 | 256 | 30 | 100 |
| medium | 1.0 | 512 | 120 | 512 |
| high | 2.0 | 1024 | 300 | 1024 |
| critical | 2.0 | 2048 | 600 | 2048 |

### 3.3 Training VRAM Requirements by Method

| Method | VRAM Formula | 7B Model | 13B Model | 70B Model |
|--------|-------------|----------|-----------|-----------|
| Full fine-tune | params_B * 18 GB | 126 GB | 234 GB | 1260 GB |
| LoRA | params_B * 2 GB + 0.5 GB | 14.5 GB | 26.5 GB | 140.5 GB |
| QLoRA (4-bit) | params_B * 0.5 GB + 0.5 GB | 4 GB | 7 GB | 35.5 GB |

---

## 4. Substrate Availability Detection

How KiloCode detects what is available at startup and during operation.

| Substrate | Detection Method | When Checked | Fallback If Unavailable |
|-----------|-----------------|-------------|------------------------|
| Extension Host | Always available (VS Code guarantees) | Activation | N/A (required) |
| Webview | Always available when panel is open | Panel open | N/A (required for UI) |
| CLI Backend | `KiloConnectionService` HTTP ping to localhost port | Activation + periodic (5s) | Show "CLI not running" status; auto-restart |
| Hermes Bridge | `HermesClient.health()` HTTP ping with 3s timeout | Activation + periodic (30s) | `hermes.enabled=false` disables pipeline; tasks not submitted |
| ZeroClaw Sandbox | Hermes health response includes ZeroClaw status | Via Hermes health check | Direct execution with warning (no sandbox isolation) |
| Shiba Backend | WebSocket handshake + ping/pong (15s interval, 5s timeout) | Activation + continuous | Writes queued in local SQLite WAL; reads return stale cache |
| Local GPU | `nvidia-smi --query-gpu=...` child process | On training tab open + before job submission | CPU-only mode or remote GPU providers |
| CUDA toolkit | `nvcc --version` child process | After GPU detected | Training unavailable locally |
| Remote GPU (RunPod) | `RUNPOD_API_KEY` env var present + API ping | Before GPU selection | Other remote providers or local-only |
| Remote GPU (Lambda) | `LAMBDA_API_KEY` env var present + API ping | Before GPU selection | Other remote providers or local-only |
| Remote GPU (Vast.ai) | `VASTAI_API_KEY` env var present + API ping | Before GPU selection | Other remote providers or local-only |
| SSH Remote Host | Connection state machine (disconnected -> connecting -> connected) | User-initiated or auto-connect | Manual SSH; no remote operations |
| Docker on Remote | `docker info` via SSH channel | After SSH connection established | Manual container management |
| Ollama | HTTP GET `http://localhost:11434/api/tags` | Provider health check cycle | Cloud providers only; `private_data` tasks blocked |
| LM Studio | HTTP GET `http://localhost:1234/v1/models` | Provider health check cycle | Ollama fallback; cloud providers |
| CI/CD Runner | GitHub Actions API status check | Before release pipeline trigger | Manual build/publish |
| TTS Providers | `testConnection(apiKey, region)` per provider | Settings panel + before first synthesis | Browser Web Speech API (always available, offline) |

---

## 5. Security Boundaries

### 5.1 Trust Levels and Access Matrix

| Substrate | Trust Level | Can Access | Cannot Access |
|-----------|------------|-----------|---------------|
| Extension Host | High | VS Code API, filesystem, network, child processes, SecretStorage, all services | Webview DOM, browser APIs |
| Webview | Low | DOM, CSP-scoped fetch, Web Audio, postMessage to Extension Host | Filesystem, Node.js, VS Code API, SecretStorage, child processes |
| CLI Backend | Medium | localhost network, SDK client, provider APIs via configured keys | VS Code API, filesystem outside working directory, SecretStorage |
| Hermes Bridge | High (server) | Task state, ZeroClaw dispatch, Shiba writes, ledger, policy engine | VS Code instance, user filesystem directly |
| ZeroClaw Sandbox | Minimal (per policy) | Mounted paths only (ro or rw per write_mode), filtered env vars, policy-scoped network | System paths (`/etc`, `/usr`, `/var`), user HOME outside project, unfiltered env vars, unrestricted network (unless policy=full) |
| Shiba Backend | Medium (server) | Memory entries (scoped by project_id), auth tokens | VS Code instance, filesystem, execution |
| Local GPU | High (local process) | Full system access (runs as user process) | Network-isolated during training (no outbound calls) |
| Remote GPU | Medium (rented instance) | Instance filesystem, GPU, outbound network for checkpoint upload | Developer local filesystem, VS Code, other cloud resources |
| SSH Remote Host | Variable (developer-owned) | Whatever the SSH user has access to on remote | Local VS Code instance (data flows through Extension Host only) |
| Local Inference Server | Medium | Local model files, localhost network | Internet (runs locally, no auth, no outbound) |
| CI/CD Runner | Medium (ephemeral) | Repository code, build dependencies, configured secrets | Developer machine, production systems (unless explicitly configured) |
| TTS Cloud Endpoints | N/A (external service) | Audio synthesis from text input | Nothing on developer machine (receives text, returns audio) |

### 5.2 Credential Storage by Substrate

| Credential | Stored In | Accessed By | Resolution Method |
|------------|-----------|------------|-------------------|
| Hermes API key | VS Code SecretStorage | Extension Host | SecretStorage -> env var fallback chain (`HERMES_API_KEY`, `KILOCODE_API_KEY`, `MINIMAX_API_KEY`, `ANTHROPIC_API_KEY`) |
| Provider API keys (Claude, MiniMax, SiliconFlow) | VS Code SecretStorage | Extension Host | SecretStorage keyed by `authRef` field in provider registry |
| SSH private key passphrases | VS Code SecretStorage | Extension Host | `secret://` URI resolved at connect time |
| Shiba auth token | Environment variable `SHIBA_AUTH_TOKEN` | Extension Host | JWT from env; refreshed 300s before expiry |
| Remote GPU API keys | Environment variables (`RUNPOD_API_KEY`, `LAMBDA_API_KEY`, `VASTAI_API_KEY`) | Extension Host | Direct env var read |
| TTS provider API keys | VS Code settings `kilo-code.new.speech.*` | Webview | Settings API (not SecretStorage -- lower sensitivity, webview needs direct access) |
| VPS cloud provider credentials | VS Code SecretStorage or environment variables | Extension Host | SecretStorage with env fallback |
| CI/CD secrets | GitHub Actions secrets | CI/CD Runner | Injected by GitHub Actions at runtime |

### 5.3 Network Boundary Rules

| From | To | Allowed | Protocol | CSP Required |
|------|-----|---------|----------|-------------|
| Extension Host | CLI Backend | Yes | HTTP + SSE to localhost | No (Node.js) |
| Extension Host | Hermes Bridge | Yes | HTTP + SSE | No (Node.js) |
| Extension Host | Shiba Backend | Yes | WSS | No (Node.js) |
| Extension Host | Cloud Provider APIs | Yes (via CLI Backend) | HTTPS | No (Node.js) |
| Extension Host | SSH Remote Host | Yes | TCP (SSH) | No (Node.js) |
| Extension Host | GPU Provider APIs | Yes | HTTPS | No (Node.js) |
| Extension Host | GitHub API | Yes | HTTPS | No (Node.js) |
| Webview | TTS Providers | Yes | HTTPS | Yes (CSP connect-src) |
| Webview | CLI Backend | Yes | HTTP + WS to localhost | Yes (CSP connect-src) |
| Webview | Any other external | No | -- | Blocked by CSP |
| ZeroClaw Sandbox | Internet | Policy-dependent | none/limited/full | iptables in network namespace |
| Local Inference Server | Internet | No | -- | Runs localhost-only |

---

## 6. Inter-Substrate Communication Patterns

### 6.1 Extension Host <-> Webview

All communication via `postMessage` / `onMessage`. Every message has a `type` discriminator. Payloads must be JSON-serializable. Large data (>100 KB) chunked or referenced by ID.

```
Webview                     Extension Host
  |                               |
  |--postMessage({type,payload})->|
  |                               |--dispatch to service
  |                               |<-service result
  |<-postMessage({type,payload})--|
  |                               |
```

### 6.2 Extension Host <-> CLI Backend

Single gateway: `KiloConnectionService`. HTTP requests for commands, SSE for streaming responses.

```
Extension Host              CLI Backend (localhost)
  |                               |
  |--HTTP POST /request---------->|
  |<-HTTP 200 {id}----------------|
  |--SSE GET /events/{id}-------->|
  |<-SSE: data chunks------------|
  |<-SSE: done--------------------|
  |                               |
```

### 6.3 Extension Host <-> Hermes Bridge

`HermesClient` for HTTP requests. SSE for task state streaming. Task envelopes flow out; state events flow back.

```
Extension Host              Hermes Bridge
  |                               |
  |--POST /tasks {envelope}------>|
  |<-201 {task_id, state}---------|
  |--GET /tasks/{id}/events------>|
  |<-SSE: state=queued------------|
  |<-SSE: state=executing--------|
  |<-SSE: state=completed--------|
  |                               |
```

### 6.4 Extension Host <-> Shiba Backend

`ShibaClient` maintains persistent WebSocket. Request/response multiplexed over the same connection with correlation IDs.

```
Extension Host              Shiba Backend
  |                               |
  |==WSS connect=================>|
  |<-WSS handshake OK=============|
  |--WSS: {type:"write",...}----->|
  |<-WSS: {type:"write_ack",...}--|
  |--WSS: {type:"recall",...}---->|
  |<-WSS: {type:"recall_res",...}-|
  |--WSS: ping------------------->|
  |<-WSS: pong--------------------|
  |                               |
```

### 6.5 Hermes Bridge <-> ZeroClaw (KiloCode never calls this)

Documented for completeness. KiloCode never sees or calls Bridge B.

```
Hermes Bridge               ZeroClaw Sandbox
  |                               |
  |--POST /jobs {job}------------>|
  |                               |--create workspace
  |                               |--mount scopes
  |                               |--apply network policy
  |                               |--execute command
  |                               |--collect artifacts
  |<-{status, artifacts, writes}--|
  |                               |--destroy workspace (after retention)
  |                               |
```

---

## 7. Substrate Lifecycle

### 7.1 Startup Sequence

```
1. VS Code activates extension
   -> Extension Host starts
   -> extension.ts wires services (constructor injection)

2. Extension Host spawns CLI Backend
   -> opencode server starts on localhost port
   -> KiloConnectionService pings until healthy

3. Extension Host connects to Hermes (if enabled)
   -> HermesClient.health() ping
   -> HermesStatusService caches result

4. Extension Host connects to Shiba (if configured)
   -> ShibaClient opens WebSocket
   -> ShibaService drains queued writes on connect

5. User opens sidebar
   -> Webview created
   -> Extension Host builds HTML with CSP
   -> Webview loads Solid.js app
   -> postMessage handshake establishes communication

6. Extension Host runs detection checks
   -> nvidia-smi for local GPU
   -> Provider health checks for all registered providers
   -> Ollama/LM Studio localhost pings
```

### 7.2 Shutdown Sequence

```
1. User closes VS Code or deactivates extension
   -> Extension Host disposes all services

2. SSH connections closed gracefully
   -> Send EOF to all PTY channels
   -> Close SFTP sessions
   -> Disconnect SSH sockets

3. Shiba WebSocket closed
   -> Pending writes flushed to local queue
   -> WebSocket close frame sent

4. CLI Backend child process killed
   -> SIGTERM sent
   -> Grace period (5s)
   -> SIGKILL if still alive

5. Hermes SSE connections closed
   -> EventSource closed for all active task subscriptions

6. Webview destroyed
   -> Browser sandbox torn down by VS Code
   -> Audio playback stopped
   -> In-memory caches (LRU, speech) garbage collected
```

---

## 8. Cost Summary

| Substrate | Cost Category | Free Tier | Paid Rate | Budget Control |
|-----------|--------------|-----------|-----------|----------------|
| Extension Host | Free | Unlimited | N/A | N/A |
| Webview | Free | Unlimited | N/A | N/A |
| CLI Backend | Free | Unlimited | N/A | N/A |
| Cloud LLM Providers | Per-token | Varies by provider | Claude: $0.003/$0.015 per 1K in/out; MiniMax: $0.0004/$0.0016; SiliconFlow: $0.0002/$0.0008 | `cost_budget.max_cost_usd` per request + `session_remaining_usd` |
| Local Inference | Electricity | Unlimited | ~$0.01-0.05/hr electricity | N/A |
| Remote GPU Training | Per-hour | None | $0.40-$3.49/hr depending on GPU + provider | `GpuAllocator` selects cheapest available; estimated cost shown before job start |
| TTS (Azure) | Per-character | 500K chars/month | $16/1M chars beyond free tier | Provider selection; Browser fallback is free |
| TTS (Google) | Per-character | 4M chars/month | $4/1M chars beyond free tier | Provider selection |
| TTS (OpenAI) | Per-character | $5 free credit | $15/1M chars | Provider selection |
| TTS (ElevenLabs) | Per-character | 10K chars/month | $5/month (30K chars) | Provider selection |
| TTS (Polly) | Per-character | 5M chars/month (12 mo) | $4/1M chars | Provider selection |
| TTS (Browser) | Free | Unlimited, offline | N/A | Always available fallback |
| CI/CD (GitHub Actions) | Per-minute | 2000 min/month (free tier) | $0.008/min (Linux) | Pipeline configuration |

---

## 9. Cross-Reference: Architecture Boundaries Compliance

Every substrate mapping in this document respects the layer rules from `ARCHITECTURE_BOUNDARIES.md`:

| Rule | Compliance in Substrate Mapping |
|------|-------------------------------|
| L1 -> L2: Extension Host may instantiate Service Layer | All service instantiation happens in Extension Host (`extension.ts`) |
| L2 -> L4: Services call External clients, never the reverse | `HermesClient`, `ShibaClient`, `VpsApiClient`, `TrainingApiClient` are all called by services, never call services |
| L1 <-> L3: Only via postMessage | Every Webview operation in this document communicates with Extension Host exclusively via postMessage |
| L3 -> L4: Webview calls external only for CSP-whitelisted read-only display data | Only TTS endpoints (audio streaming) are called from webview; all write operations go through Extension Host |
| L3 -/-> L2: Webview never imports extension host code | Webview substrates have no access to Node.js or VS Code API |
| KiloCode never calls ZeroClaw directly | All ZeroClaw operations go through Hermes Bridge via `HermesClient` |
| No circular service imports | Each service calls its dependencies; no bidirectional service-to-service calls |
