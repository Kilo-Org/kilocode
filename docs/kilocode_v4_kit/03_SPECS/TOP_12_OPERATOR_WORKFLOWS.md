# Top 12 Operator Workflows

Version: 1.0.0
Date: 2026-04-17
Phase: 11 of 72-phase plan

Coverage: All 7 master-contract roles are represented.

| Role | Workflows |
|---|---|
| IDE cockpit | All (primary UI surface for every workflow) |
| Remote systems console | 1, 3, 11 |
| Governed execution surface | 2, 8 |
| Provider-routing control surface | 4 |
| Memory-aware agent workbench | 5 |
| Training orchestration dashboard | 6, 10 |
| Release and rollback control center | 7, 9, 12 |

---

## Workflow 1: Connect to Remote Host and Execute Command

**Actor:** Developer / Operator
**Subsystems:** SSH, Terminal, Governance (Tier 0 read / Tier 1 write)
**Trigger:** Operator selects a saved SSH host profile from the Remote Ops panel

**Steps:**

1. Open Activity Bar -> Remote Ops panel. The host tree view renders groups and profiles from `config/ssh/profiles.yaml` and `config/ssh/groups.yaml`. Each host shows its last-known connection state via a badge (green/yellow/red).
2. Select a host profile -> KiloCode calls `SshService.connect(profileId)`. `SshTransport` resolves the private key or password from VS Code `SecretStorage` using the `passphrase` field's `secret://` URI. If `jumpHost` is set, the jump-host profile is connected first.
3. `SshTransport` opens a TCP socket to `host:port` (default 22). The connection state machine transitions: `disconnected -> connecting -> authenticating`.
4. Authentication succeeds -> state transitions to `connected`. `SshService` starts keep-alive pings at `keepAliveInterval` (default 15 000 ms). A terminal tab opens in the Remote Ops panel backed by a PTY session over the SSH channel.
5. Operator types a command in the terminal panel. The command is sent over the SSH channel's exec/shell stream. `AuthorityService.check("ssh_exec", actor)` evaluates: Tier 0 for read-only commands, Tier 1 for write commands.
6. Output streams back via the SSH channel and is rendered in the webview terminal panel via postMessage. The session is recorded in `data/ssh/sessions/{sessionId}`.
7. Operator disconnects, or KiloCode detects idle timeout. `SshService.disconnect(profileId)` closes the channel and transitions state to `disconnected`. A run-ledger entry is written via `AuditLogger`.

**Failure paths:**

- **Auth failed** -> `SSH_AUTH_FAILED` emitted. Connection state returns to `disconnected`. UI shows notification: "Authentication failed. Check username and password." Retry button offers to re-enter credentials or select a different key via `SshProfileManager`.
- **Host unreachable** -> TCP connection refused or DNS resolution fails within `connectTimeout` (default 10 000 ms). `SSH_HOST_UNREACHABLE` emitted. UI shows: "Cannot reach host. Verify hostname and network."
- **Connection dropped mid-session** -> `SSH_KEEPALIVE_DEAD` emitted after `keepAliveCountMax` missed pongs. `SshService` enters `reconnecting` state with exponential backoff (initial 1 s, max 30 s, multiplier 2x). After `maxReconnectAttempts`, transitions to `disconnected` with `SSH_HOST_UNREACHABLE`.
- **Key invalid** -> `SSH_KEY_INVALID` emitted if the private key file is unreadable, wrong format, or passphrase is incorrect. UI offers to re-enter passphrase or select a different key file.

**Required subsystems:** `SshService`, `SshTransport`, `SshProfileManager` (`services/ssh/`); webview terminal component (`components/remote/`); `AuditLogger` (`services/governance/`)

**Risk level:** Low (read-only commands), Medium (file-modifying commands), High (sudo/root, system-config commands)

**Approval required:** None for Tier 0 read commands. Operator confirmation toast for Tier 1 write commands. Full Tier 2 approval for destructive operations (e.g., `rm -rf`, service restarts).

---

## Workflow 2: Submit Task to ZeroClaw Sandbox

**Actor:** Developer / Operator
**Subsystems:** Hermes Pipeline, ZeroClaw (via Hermes), Governance, Provider Routing
**Trigger:** Operator types a task description in the chat prompt and the Hermes pipeline toggle is enabled (`kilo-code.new.hermes.enabled: true`)

**Steps:**

1. Operator enters intent in the chat PromptInput (e.g., "Run the test suite and fix any failing tests"). The chat view detects that Hermes is active via `HermesStatusService`.
2. `TaskIntakeService` constructs a `TaskEnvelope` per the ZeroClaw intake schema: generates `task_id` (format `task-{nanoId}-{nanoId}`), sets `origin: "kilocode"`, populates `project_path`, `description`, `requested_by`, and `allowed_workspace_scope` from the current workspace.
3. `RiskClassifier` evaluates the task type, scope, and policies to compute `risk_level` (low/medium/high/critical) using the classification table. Escalation rules are applied: `network_policy=full` bumps risk one tier; `write_policy=direct` ensures minimum medium.
4. `HermesPipeline` calls `HermesClient.submitTask(envelope)` -> `POST /tasks` to the Hermes Bridge API at `baseUrl` (default `http://187.77.30.206:18789`). Returns `TaskCreated { task_id, state: "queued" }`.
5. `HermesPipeline` subscribes to `GET /tasks/{task_id}/events` via SSE. Task events stream through the state machine: `queued -> planning -> awaiting_approval -> executing_in_zeroclaw -> validating -> completed`.
6. If `risk_level` is medium and `approval_mode` is `auto-low`, Hermes auto-approves and execution proceeds. If high/critical, the Execution panel (`components/execution/`) shows the approval modal with the diff of proposed changes and the approval chain.
7. For high-risk tasks: each required signer in `approval_chain` reviews and approves via the approval modal. KiloCode sends `POST /tasks/{task_id}/approve` when all required signers approve.
8. ZeroClaw executes in a sandboxed workspace with the resource limits from the envelope (cpu, memory, timeout, disk). For buffered writes, results are held for diff review before application.
9. Hermes validates results, writes ledger entries, and optionally writes memory to Shiba (`memory_ids_written`). SSE emits `completed` with `artifacts_url`.
10. KiloCode renders results in the chat: summary, diff viewer for file changes, and artifacts link. The run is recorded in the audit trail.

**Failure paths:**

- **Hermes unreachable** -> `HermesClient` health ping fails. `HermesStatusService` shows "Bridge Offline" in the status bar. Task submission is blocked with a notification: "Hermes bridge is not reachable. Check connection." Retry after `HermesStatusService` confirms recovery.
- **Approval denied** -> A required signer denies the task. Hermes emits `ZC_APPROVAL_DENIED`. KiloCode shows: "Task approval denied by {signer}." Task moves to `failed` state. No execution occurs.
- **Approval timeout** -> Approval chain not completed within the approval window (configurable, default 30 min). `ZC_APPROVAL_TIMEOUT` emitted. Task moves to `failed`.
- **Execution timeout** -> ZeroClaw kills the task after `resource_limits.timeout` + 10 s grace period. `ZC_TIMEOUT` emitted. KiloCode shows: "Task timed out after {n} seconds."
- **Execution failed** -> Task process exits non-zero. `ZC_EXECUTION_FAILED` emitted with exit code. Partial artifacts may be available.

**Required subsystems:** `HermesClient`, `HermesPipeline`, `HermesStatusService` (`services/hermes/`); `RiskClassifier`, `TaskIntakeService` (`services/zeroclaw/`); `AuthorityService` (`services/governance/`); Execution panel (`components/execution/`)

**Risk level:** Determined per-task by `RiskClassifier` (low/medium/high/critical)

**Approval required:** Auto for low risk (when `approvalMode: "auto-all"` or `"auto-low"`). Operator confirm for medium risk. Full approval chain for high/critical (owner + confirmer, or full triad + judge for critical).

---

## Workflow 3: Browse and Edit Remote Files via SFTP

**Actor:** Developer / Operator
**Subsystems:** SSH, SFTP, Diff Viewer, Governance
**Trigger:** Operator clicks a connected host in the Remote Ops panel and expands the file tree

**Steps:**

1. With an active SSH connection (see Workflow 1), the operator expands the file tree node for the connected host. `SftpService.list(profileId, remotePath)` is called to fetch directory contents via the SFTP subsystem.
2. The remote file tree (`components/remote/`) renders entries with icons for files, directories, and symlinks. Entries are paginated for directories with 10 000+ items to keep UI responsive (< 2 s render).
3. Operator clicks a file -> `SftpService.read(profileId, filePath)` fetches the file contents. The remote mtime and SHA-256 checksum are stored for conflict detection.
4. The file is written to a local temp buffer at `{tmpDir}/kilo-remote/{profileId}/{path}` and opened in a VS Code editor tab via the standard text editor API.
5. Operator edits the file in the VS Code editor. The buffer is marked dirty (standard VS Code dirty indicator).
6. On save, KiloCode computes a unified diff between the original fetched content and the current buffer. If the remote file has changed since fetch (mtime/checksum mismatch on pre-check), a three-pane conflict dialog opens: Remote (theirs) | Base (original fetch) | Local (yours).
7. The diff panel (`DiffViewerProvider`) opens showing additions/deletions. Buttons: "Apply", "Cancel", "Edit more".
8. Operator clicks "Apply" -> `SftpService.write(profileId, filePath, bufferContent, flags="overwrite")` uploads the file. `SftpService.stat()` verifies the upload by comparing size and first-64-byte prefix. Buffer is marked clean and stored checksums are updated.

**Failure paths:**

- **File not found** -> `SFTP_NOT_FOUND` shown in notification: "File or directory not found on remote host." File tree node is removed or greyed out.
- **Permission denied (read)** -> `SFTP_PERMISSION_DENIED` shown: "Permission denied on remote file." File node shows a lock icon.
- **Permission denied (write)** -> `SFTP_PERMISSION_DENIED` on upload. Notification shown, buffer stays dirty. Operator can save locally or retry with different credentials.
- **Disk quota exceeded** -> `SFTP_QUOTA_EXCEEDED` on upload: "Remote disk full or quota exceeded." Buffer stays dirty.
- **Connection drops during upload** -> `SFTP_TRANSFER_INTERRUPTED`. Write is queued for retry after SSH reconnect (see Workflow 1 reconnect logic). User is notified: "Transfer interrupted. Will retry after reconnect."

**Required subsystems:** `SshService`, `SftpService` (`services/ssh/`); `DiffViewerProvider` (`DiffViewerProvider.ts`); remote file tree (`components/remote/`); `AuditLogger` (`services/governance/`)

**Risk level:** Low (browsing/reading), Medium (file edits/saves)

**Approval required:** None for read operations. Diff review (operator self-approve via Apply button) for writes. Tier 2 approval for writes to system config paths (`/etc/`, `/usr/`, systemd units).

---

## Workflow 4: Route a Task to the Correct AI Provider

**Actor:** Operator / System (automated routing)
**Subsystems:** Provider Routing, Provider Registry, Provider Health
**Trigger:** A task is submitted (via chat, agent manager, or Hermes pipeline) and requires an AI provider

**Steps:**

1. A task arrives with a `task_type` (e.g., `contract_writing`, `code_execution`, `bulk_processing`). If Hermes is active, Hermes owns routing and KiloCode defers entirely. If Hermes is inactive, `ProviderRouter` handles client-side routing.
2. `ProviderRouter` loads the role matrix from `config/providers.yaml`. The matrix maps each `task_type` to a `primary_provider` and ordered `fallback_provider` chain (max depth 3).
3. `ProviderRouter` checks `ProviderHealthService` cache for the primary provider's status. Health checks run on a configurable interval and results are cached -- the router reads cache, never triggers checks.
4. If primary provider status is `healthy`: route to it. `ProviderRouter` returns a `RoutingDecision { provider_id, lane, reason: "primary" }`.
5. If primary is `degraded` or `offline`: traverse the fallback chain. For each fallback, check health status and capability match. First healthy fallback with the required capability is selected.
6. If no provider is available: emit `ROUTE_NO_PROVIDER`. For `verdict_generation` tasks (no fallback allowed), queue the task and notify the operator via the notification system. For other task types, offer the operator a manual provider selection via the Provider Select dialog (`ProviderSelectDialog.tsx`).
7. `ProviderRouter` logs the routing decision (provider chosen, reason, latency, fallback depth) to telemetry.
8. The selected provider processes the task. If it returns a 401 (`ROUTE_AUTH_FAILED`) or 429 (`ROUTE_RATE_LIMITED`), the router retries with the next fallback. If it returns a 504 (`ROUTE_TIMEOUT`), retry or failover.
9. Special case: `private_data` tasks are hard-blocked from cloud providers. Only `type: local` providers (e.g., `ollama-local`, `lmstudio-local`) are eligible. Violation emits `ROUTE_PRIVACY_VIOLATION`.

**Failure paths:**

- **All providers offline** -> `ROUTE_NO_PROVIDER` after exhausting the fallback chain. Notification: "No providers available for {task_type}. Check provider health in Settings > Providers." Task is queued for retry when any provider comes back online.
- **Auth failed** -> `ROUTE_AUTH_FAILED` (HTTP 401). Provider credentials invalid. Notification: "Provider {name} rejected credentials. Rotate API key in Settings > Providers." The provider is removed from the routing pool until credentials are updated.
- **Rate limited** -> `ROUTE_RATE_LIMITED` (HTTP 429). Retry with exponential backoff or immediate failover to next provider in chain.
- **Privacy violation attempt** -> `private_data` task accidentally routed to cloud. `ROUTE_PRIVACY_VIOLATION` is a hard error, never retried to cloud. Operator must select a local provider.

**Required subsystems:** `ProviderRouter`, `ProviderRegistry`, `ProviderHealthService`, `ProviderApiClient` (`services/providers/`); ProvidersTab, ProviderSelectDialog (`components/settings/`); telemetry (`services/telemetry/`)

**Risk level:** Low (routing is a control-plane decision, no data mutation)

**Approval required:** None for automated routing. Tier 1 for adding/removing providers from the registry. Tier 2 for modifying the role matrix or fallback chains.

---

## Workflow 5: Recall Project Context from Shiba Memory

**Actor:** Developer / Agent (automated context injection)
**Subsystems:** Memory/Shiba, Chat, Agent Manager
**Trigger:** Agent session starts, or operator explicitly searches memory via the Memory panel

**Steps:**

1. **Automated recall (session start):** When a new chat session or agent-manager worktree session begins, `ContextInjector` is invoked. It calls `ShibaService.search({ project_id, scope: "project", limit: 10 })` to retrieve the most relevant memory entries for the current project.
2. `ShibaService` sends the search query over the persistent WebSocket connection to Shiba (`wss://shiba.kilocode.internal/v1/ws`). The connection is managed with keep-alive pings every 15 s and automatic reconnection with exponential backoff (initial 1 s, max 30 s, multiplier 2x, max retries 10).
3. Shiba returns a ranked list of `MemoryEntry` results. `ContextInjector` filters by relevance score and scope permissions (an agent can only read scopes it has been granted access to per the permission matrix in `config/memory.yaml`).
4. The filtered memory entries are injected into the agent's context window as system-level context. The chat UI does not display raw memory entries unless the operator opens the Memory panel.
5. **Manual recall:** Operator opens the Memory panel (`components/memory/`) from the Activity Bar. The search panel allows free-text queries, scope filters (global/project/session), and key-path filters.
6. `ShibaService.search(query)` returns results. The memory browser displays entries with key, value preview, scope badge, agent attribution, and timestamps.
7. Operator can click an entry to expand the full value in the context preview pane. From here, "Add to Context" injects the entry into the current chat session's context.

**Failure paths:**

- **Shiba unreachable** -> WebSocket connection fails. `ShibaService` enters `reconnecting` state. After `maxRetries` (10) exhausted, emits `MEM_CONNECTION_LOST`. The Memory panel shows "Shiba offline" badge. `ContextInjector` falls back to locally cached entries from the SQLite WAL queue (`data/memory/dead_letter.jsonl` for failed writes, local index for reads).
- **Recall timeout** -> Read query exceeds `read_ms` timeout (default 3 000 ms). `MEM_RECALL_TIMEOUT` emitted. If cached results are available from the local index, they are returned. Otherwise, empty results with error.
- **Scope denied** -> Agent attempts to read a scope it lacks permission for (e.g., cross-project read without `global_read` permission). `MEM_SCOPE_DENIED` returned. Denial is logged in the audit trail. No data is exposed.

**Required subsystems:** `ShibaService`, `ShibaClient`, `MemoryIndexService`, `ContextInjector` (`services/memory/`); Memory panel (`components/memory/`); `AuditLogger` (`services/governance/`)

**Risk level:** Low (read-only recall). Medium (memory writes are fire-and-forget via Hermes/ZeroClaw, never from KiloCode directly per the boundary rule "KiloCode never writes memory -- Hermes owns Shiba").

**Approval required:** None for project-scope reads. Tier 1 for global-scope reads. Tier 2 for memory purge operations.

---

## Workflow 6: Launch and Monitor a Training Job

**Actor:** ML Operator
**Subsystems:** Training, GPU Allocation, Monitoring
**Trigger:** Operator opens the Training panel and clicks "New Training Job"

**Steps:**

1. Operator opens the Training panel (`components/training/`) from the Activity Bar. The dataset browser lists registered datasets from `DatasetService` (loaded from `config/training.yaml`, storage at `data/datasets/`).
2. Operator selects a validated dataset (`validation_status: "valid"`) and clicks "New Job". The job creation wizard opens.
3. Operator configures the job: selects `model_base` (e.g., "meta-llama/Llama-3.1-8B"), `method` (lora/qlora/full), and either picks a preset (`lora_default`, `qlora_default`, `full_finetune` from `config/training.yaml`) or tunes hyperparameters manually (learning rate, epochs, batch size, LoRA rank, etc.).
4. `GpuAllocator` runs auto-select: estimates VRAM requirement (full: params * 18 GB, lora: params * 2 GB + 500 MB, qlora: params * 0.5 GB + 500 MB). Checks local GPU via `nvidia-smi`. If local VRAM sufficient, selects `local_gpu` ($0 cost). Otherwise queries remote providers (RunPod, Lambda, Vast.ai) from `config/training.yaml` remote_providers, filters by VRAM and availability, sorts by cost. Presents the selection with estimated cost and duration.
5. Operator confirms GPU target and cost estimate. `TrainingJobService.submit(job)` creates the `TrainingJob` record with status `queued` and sends it to the training backend via `TrainingApiClient`.
6. Job status transitions: `queued -> preparing -> running`. The Training panel job dashboard shows real-time metrics streamed via SSE: train_loss, val_loss, learning_rate, GPU utilization, VRAM usage, throughput (tokens/sec).
7. Monitoring events are emitted every `log_interval_steps` (default 10 steps) and stored at `data/training/logs/{job_id}/events.jsonl`. TensorBoard logs are written to `data/training/tensorboard/{job_id}/`.
8. Checkpoints are saved every `checkpoint_interval_steps` (default 1 000 steps) to `data/training/checkpoints/{job_id}/`. Each checkpoint records metrics, optimizer state, and a SHA-256 integrity checksum.
9. If `early_stopping.enabled: true`, training halts after `patience` epochs (default 3) without val_loss improvement beyond `min_delta` (default 0.001). Status transitions to `completed`.
10. On completion, `TrainingJobService` records final metrics (best val_loss, total duration, total cost) and the job summary is written to `data/training/logs/{job_id}/summary.json`.

**Failure paths:**

- **No GPU available** -> `TRAIN_GPU_NOT_FOUND`. No local GPU detected and no remote provider configured or available. Notification: "No GPU available. Install CUDA drivers or configure a remote provider in Settings > Training."
- **Out of memory** -> `TRAIN_OOM` during training. GPU ran out of VRAM. Notification suggests: reduce batch_size, switch to QLoRA, use gradient accumulation, or select a larger GPU.
- **Dataset invalid** -> `TRAIN_DATASET_INVALID` if the selected dataset has `validation_status: "invalid"`. Blocks job submission until issues in `validation_errors[]` are resolved.
- **Remote GPU disconnected** -> `TRAIN_REMOTE_DISCONNECTED`. Connection to remote GPU instance lost. Training pauses. Operator can resume from the last checkpoint once connectivity is restored.
- **Checkpoint corrupted** -> `TRAIN_CHECKPOINT_CORRUPTED` on resume attempt (checksum mismatch). Operator must select an earlier checkpoint or restart.

**Required subsystems:** `DatasetService`, `TrainingJobService`, `GpuAllocator`, `TrainingApiClient` (`services/training/`); Training panel (`components/training/`); `AuditLogger` (`services/governance/`)

**Risk level:** Medium (resource consumption, cost). High (remote GPU allocation with cost > $50 estimated).

**Approval required:** None for local GPU jobs. Tier 1 for remote GPU jobs under $50 estimated cost. Tier 2 for remote GPU jobs over $50 estimated cost or full fine-tune method.

---

## Workflow 7: Deploy Application to VPS

**Actor:** DevOps Operator
**Subsystems:** VPS, SSH, Governance, Release
**Trigger:** Operator selects a VPS instance and initiates a deploy action

**Steps:**

1. Operator opens the Infrastructure panel (`components/infrastructure/`). The instance list shows all VPS entries from `config/vps/inventory.yaml` with status badges (running/stopped/unreachable/provisioning).
2. Operator selects the target VPS instance. The metrics dashboard shows real-time monitoring: CPU usage, RAM, disk, network throughput (polled every 30 s via SSH commands executed on the remote host through the linked `sshProfileId`).
3. Operator clicks "Deploy" -> the deploy wizard opens. Operator selects the deployment method: Docker Compose update, git pull + restart, or artifact upload. Operator specifies the version/tag to deploy.
4. `AuthorityService.check("deployment", actor)` evaluates the required tier. Staging deploys require Tier 2 (owner + confirmer). Production deploys require Tier 3 (full triad + release judge). If the tier is insufficient, `GOV_TIER_INSUFFICIENT` is returned and the operator is directed to escalate.
5. For Tier 2+, an `ApprovalRequest` is created and required approvers are notified. The approval queue (`components/governance/`) shows the pending request with action description, risk level, and evidence links.
6. Once approved, `VpsService` delegates to `SshService` for the actual deployment. For Docker Compose: `docker compose -f <file> pull && docker compose -f <file> up -d`. For git-based: `cd /app && git fetch && git checkout <tag> && ./deploy.sh`. Commands are executed over the SSH channel.
7. Deployment output streams to the terminal panel in real time. `VpsMonitor` watches health metrics during and after deploy.
8. Post-deploy verification: `VpsMonitor` checks that all services listed in the VPS inventory `services[]` array are in `status: "running"`. Health endpoints are pinged. If verification passes, deploy is marked successful and an audit record is written.

**Failure paths:**

- **VPS unreachable** -> SSH connection to the VPS fails (`SSH_HOST_UNREACHABLE`). Deploy is blocked. Operator must verify network connectivity and VPS status via the cloud provider console.
- **Approval denied** -> `GOV_APPROVAL_DENIED`. A required approver denied the deployment. The denial reason and comment are shown. Operator must address concerns and resubmit.
- **Approval expired** -> `GOV_APPROVAL_EXPIRED`. The approval request timed out (Tier 2: 48 h, Tier 3: 72 h). Operator resubmits.
- **Deploy command fails** -> SSH command exits non-zero. Terminal shows error output. `VpsMonitor` detects service degradation. Operator can initiate rollback (see Workflow 9).
- **Post-deploy health check fails** -> Services not responding after deploy. `VpsMonitor` raises alert. The operator is prompted: "Health check failed. Rollback to previous version?"

**Required subsystems:** `VpsService`, `VpsMonitor`, `VpsProvisionService` (`services/vps/`); `SshService` (`services/ssh/`); `AuthorityService`, `AuditLogger` (`services/governance/`); Infrastructure panel (`components/infrastructure/`)

**Risk level:** High (staging deploy). Critical (production deploy).

**Approval required:** Tier 2 (owner + confirmer) for staging. Tier 3 (owner + confirmer + release judge) for production. Evidence required: `test_report`, `security_scan` per the `prod_release` dangerous-action registry entry.

---

## Workflow 8: Review and Approve a High-Risk Action

**Actor:** Owner, Confirmer, Release Judge (depending on tier)
**Subsystems:** Governance, Audit, Notifications
**Trigger:** A high-risk or critical-risk action generates an `ApprovalRequest` requiring multi-signer approval

**Steps:**

1. An action is initiated that requires Tier 2 or Tier 3 approval (e.g., production deployment, dataset deletion, governance rule modification). `AuthorityService` creates an `ApprovalRequest` with status `pending`, populates `required_approvers` based on the tier definition from `config/governance.yaml`, and sets `expires_at` based on the tier's `timeout_hours`.
2. Each required approver is notified via the configured notification channel. In KiloCode, a notification toast appears for connected approvers, and the Governance panel (`components/governance/`) approval queue shows the new request.
3. The approval queue displays: `action_description`, `risk_level`, `required_tier`, `requested_by`, `evidence` paths (test reports, security scan results), and `notes` from the requester.
4. Each approver opens the request detail view. For deployment actions, this includes: diff preview of changes, CI pipeline status, release checklist status, and gate condition evaluation results.
5. `PolicyEngine` evaluates `deny_conditions` from the dangerous-action registry. If any deny condition is true (e.g., `defect_ledger.critical_count > 0`, `test_suite.pass_rate < 0.95`), the request is auto-blocked with `GOV_ACTION_BLOCKED` regardless of approvals. The blocking condition is displayed.
6. Each approver submits their decision (`approved` or `denied`) with an optional comment. The decision and timestamp are recorded in `current_approvals[]`.
7. If ANY required approver denies -> request status transitions to `denied`, action is blocked. `GOV_APPROVAL_DENIED` is emitted. The denial reason and all decisions are recorded in the audit trail.
8. If ALL required approvers approve -> request status transitions to `approved`. The blocked action is unblocked and proceeds. An `AuditRecord` is written with all approver decisions, evidence paths, and the action outcome.
9. If `expires_at` passes before all approvals -> status transitions to `expired`. `GOV_APPROVAL_EXPIRED` emitted. The requester is notified and must resubmit.

**Failure paths:**

- **Tier insufficient** -> An actor without the required role attempts to approve. `GOV_TIER_INSUFFICIENT` returned. The UI does not show the approve/deny buttons to users without the correct role.
- **Cooldown active** -> The action was executed recently and the `cooldown_minutes` (e.g., 60 min for `prod_release`) has not elapsed. `GOV_COOLDOWN_ACTIVE` returned. UI shows remaining cooldown time.
- **Evidence missing** -> Required evidence artifacts (e.g., `test_report`, `security_scan`) are not attached. `GOV_EVIDENCE_MISSING` returned. The submit button is disabled until all `requires_evidence` items are attached.
- **Deny condition blocks despite approvals** -> All approvers approved, but a `deny_condition` evaluates to true (e.g., critical defects exist). `GOV_ACTION_BLOCKED` overrides approvals. The blocking condition must be resolved first.

**Required subsystems:** `AuthorityService`, `PolicyEngine`, `AuditLogger` (`services/governance/`); approval queue and audit log viewer (`components/governance/`); notification system (`context/notifications.tsx`)

**Risk level:** N/A (this workflow is the risk-control mechanism itself)

**Approval required:** The workflow IS the approval process. Tier 2 requires owner + confirmer. Tier 3 requires owner + confirmer + release judge.

---

## Workflow 9: Rollback a Failed Deployment

**Actor:** DevOps Operator (initiator), Release Judge (approver, unless emergency)
**Subsystems:** Governance (Release), VPS, SSH, Audit
**Trigger:** Post-deploy monitoring detects anomalies, a P0 incident is reported, or the operator manually triggers rollback

**Steps:**

1. **Trigger detection:** One of the automatic rollback triggers fires within 30 minutes of release: error rate > 0.5%, P0 incident reported, crash rate > 0.1%, data corruption detected, or security vulnerability discovered. Alternatively, the operator manually triggers rollback from the Release dashboard (`components/governance/`).
2. `ReleaseService` creates a `RollbackRequest` with: `trigger` (e.g., `"error_rate"`, `"p0_incident"`, `"manual"`), `current_version`, `target_version` (the last known-good version), and `emergency` flag.
3. **Non-emergency path:** `ReleaseService` creates an `ApprovalRequest` at Tier 3. Required approvers: owner, confirmer, release judge. The request references `requires_evidence: ["incident_report"]` from the `prod_rollback` dangerous-action registry entry. Approval auto-denies after 4 hours.
4. **Emergency path (P0):** If `emergency: true`, a single operator can initiate rollback immediately, bypassing Tier 3 approval. The emergency override is logged in the audit trail and a post-hoc Tier 3 review is scheduled within 24 hours.
5. **HALT:** `ReleaseService` stops any in-progress deployments, disables auto-deploy triggers, and sets the release pipeline status to `cancelled`.
6. **REVERT:** `VpsService` delegates to `SshService` to switch production to the target version. For Docker-based deployments: `docker compose -f <file> pull <target_version_tag> && docker compose -f <file> up -d`. For VSIX: unpublish current, re-publish previous version.
7. **VERIFY:** `ReleaseService` runs verification checks: `health_endpoints_responding` (all provider health checks return 200), `error_rate_normal` (< 0.1% for 15 min), `smoke_tests_pass`, `no_data_corruption`, `version_correct` (running version matches `target_version`). A 15-minute monitoring window is observed.
8. **NOTIFY:** All stakeholders (owner, confirmer, release judge, affected users) are notified. An incident record is created and linked to the rollback audit trail.
9. **POST-ROLLBACK AUDIT:** `AuditLogger` writes a complete audit record. If emergency: the scheduled post-hoc Tier 3 review appears in the approval queue. Root cause analysis is initiated. The defect ledger is updated.

**Failure paths:**

- **Rollback itself fails** -> `GOV_ROLLBACK_FAILED`. The revert step errors (e.g., target version artifacts not found, SSH connection fails during revert). Manual intervention required. The operator is directed to escalate to Tier 3 and access the VPS directly.
- **Verification fails after rollback** -> Health checks do not pass within the 15-minute window. `GOV_ROLLBACK_FAILED` with details on which checks failed. The operator must investigate further -- potential data corruption or infrastructure issue beyond the software version.
- **Approval timeout (non-emergency)** -> Tier 3 approvers do not respond within 4 hours (`auto_deny_after_hours: 4` for `prod_rollback`). `GOV_APPROVAL_EXPIRED`. If the incident severity has increased, the operator can re-trigger with `emergency: true`.

**Required subsystems:** `ReleaseService`, `AuthorityService`, `AuditLogger`, `PolicyEngine` (`services/governance/`); `VpsService`, `VpsMonitor` (`services/vps/`); `SshService` (`services/ssh/`); Release dashboard (`components/governance/`)

**Risk level:** High (rollback is a high-risk action by definition per the dangerous-action registry)

**Approval required:** Tier 3 (owner + confirmer + release judge) for normal rollback. Emergency override allows single operator with mandatory post-hoc Tier 3 audit within 24 hours.

---

## Workflow 10: Compare Training Runs and Export Model

**Actor:** ML Operator
**Subsystems:** Training, GPU, Model Export
**Trigger:** Operator has two or more completed training jobs and opens the Compare view

**Steps:**

1. Operator opens the Training panel job dashboard. Completed jobs are listed with summary metrics: model base, method, final train_loss, final val_loss, best val_loss, total duration, total cost, GPU type.
2. Operator selects two or more jobs (checkboxes) and clicks "Compare Runs". `TrainingJobService` constructs a `RunComparison` with the selected `run_ids`.
3. The Compare view renders side-by-side `RunSummary` cards showing hyperparameters, final metrics, cost, and duration for each run. `ChartDataSet` arrays are built for overlay charts.
4. Interactive charts display training curves: val_loss vs. step, train_loss vs. step, learning_rate schedule, GPU utilization, and throughput. Each run is a colored series with a label (e.g., "LoRA r=16 lr=2e-5").
5. The comparison engine identifies the `best_run_id` by the lowest `best_val_loss` and generates a `recommendation` (e.g., "Run job_xyz had the lowest val_loss (0.342) at epoch 3. Consider using its hyperparams.").
6. Operator selects the best run and clicks "Export Model". The export wizard opens with format selection: `gguf` (for llama.cpp), `safetensors` (for HuggingFace), or `onnx` (for inference servers).
7. Operator selects optional quantization (q4_0, q4_k_m, q5_k_m, q8_0, f16, f32) based on the deployment target's VRAM constraints.
8. `TrainingJobService` initiates the export pipeline: validate checkpoint integrity (SHA-256 checksum), load adapter weights, merge adapter with base model (for LoRA/QLoRA), apply quantization, convert to target format, write output to `data/training/exports/{export_id}/`.
9. A `metadata.json` sidecar is generated with: base model, training method, dataset ID, best val_loss, and the training job ID. A README model card is auto-generated.
10. Export completes. The operator can download the model file or deploy it directly (e.g., copy to an Ollama models directory for local inference, or upload to a HuggingFace repo).

**Failure paths:**

- **Checkpoint corrupted** -> `TRAIN_CHECKPOINT_CORRUPTED` when the export pipeline validates the checkpoint. Operator must select a different checkpoint from the same job (earlier epoch) or a different run entirely.
- **Export failed** -> `TRAIN_EXPORT_FAILED`. Format conversion error (e.g., incompatible quantization for the model architecture) or insufficient disk space. Notification shows the specific error. Operator adjusts format/quantization or frees disk space.
- **Comparison with incompatible runs** -> Runs with different `model_base` values can be compared (the UI shows a warning: "Different base models -- metric comparison may not be meaningful") but export can only proceed from a single run.

**Required subsystems:** `TrainingJobService`, `DatasetService` (`services/training/`); Compare view, export wizard (`components/training/`); file system access for checkpoint and export I/O

**Risk level:** Low (comparison is read-only). Medium (export writes large files to disk, consumes CPU for quantization).

**Approval required:** None for comparison. Tier 1 for model export (operator acknowledges disk and compute usage).

---

## Workflow 11: Manage Docker Containers on Remote VPS

**Actor:** DevOps Operator
**Subsystems:** VPS, SSH, Docker (via SSH commands), Governance
**Trigger:** Operator selects a VPS instance in the Infrastructure panel and opens the Docker tab

**Steps:**

1. Operator selects a running VPS instance in the Infrastructure panel. The Docker tab is available if Docker CLI is detected on the remote host (checked via `docker --version` over SSH during initial connection).
2. `SshService` executes `docker ps -a --format '{{json .}}'` on the remote host. The container list panel renders: container name, image, status (running/exited/paused), ports, and creation time.
3. Operator can inspect a container: clicks a container row -> `docker inspect <id>` is executed. The inspect panel shows the full JSON configuration, environment variables, mounts, and network settings.
4. Operator can view logs: clicks "Logs" on a container -> `docker logs --tail 200 --timestamps <id>` streams output to the output panel. Tail count is configurable.
5. **Start/restart:** Operator clicks "Start" or "Restart" on a stopped/running container. A confirmation toast appears (side-effect action). On confirm, `docker start <id>` or `docker restart -t 10 <id>` is executed. The container list refreshes.
6. **Stop/remove:** Operator clicks "Stop" or "Remove". A modal confirmation dialog appears (destructive action) showing the container name and image. On confirm, `docker stop -t 10 <id>` or `docker rm <id>` is executed. For running containers, `docker rm -f <id>` requires explicit force confirmation.
7. **Image management:** The Images sub-tab lists images via `docker images --format '{{json .}}'`. Operator can pull new images (`docker pull <image>:<tag>`, progress streamed to output panel) or remove unused images (`docker rmi <id>`).
8. **Compose operations:** If a `docker-compose.yml` is detected in the working directory, Compose actions are available: `docker compose up -d`, `docker compose down`, `docker compose ps`, `docker compose logs`. Compose down shows a modal confirmation since it stops and removes containers and networks.
9. All Docker actions are logged by `AuditLogger` with the actor, command executed, container/image identifiers, and outcome.

**Failure paths:**

- **Docker not installed** -> `docker --version` fails. The Docker tab shows: "Docker not found on this host." No Docker operations are available. Badge on the VPS entry shows "No Docker."
- **Container not found** -> `DOCKER_NOT_FOUND` if a container was removed externally since the last list refresh. Container list auto-refreshes and the stale entry is removed.
- **Permission denied** -> SSH user lacks Docker group membership. `SSH_PERMISSION_DENIED` on Docker commands. Notification: "Permission denied. Ensure the SSH user is in the docker group." Operator can retry with `sudo` prefix (requires Tier 1 approval).
- **SSH connection lost** -> All Docker commands fail. The Docker tab shows a disconnected badge. Operator must re-establish SSH connection (see Workflow 1).

**Required subsystems:** `SshService` (`services/ssh/`); `VpsService`, `VpsMonitor` (`services/vps/`); Infrastructure panel, Docker tab (`components/infrastructure/`); `AuditLogger` (`services/governance/`)

**Risk level:** Low (list, inspect, logs, ps -- read-only). Medium (start, restart, pull -- side-effect). High (stop, remove, down -- destructive).

**Approval required:** None for read-only operations. Confirmation toast for side-effect operations (start, restart, pull). Modal confirmation for destructive operations (stop, remove, down). Tier 1 for `docker rm -f` (force remove running container). Tier 2 for `docker compose down --volumes` (destroys persistent data).

---

## Workflow 12: Run Adversarial Audit Before Release

**Actor:** Release Judge / Security Operator
**Subsystems:** Governance, ZeroClaw (via Hermes), Provider Routing, Release Pipeline
**Trigger:** Release pipeline reaches the STAGE gate, or operator manually triggers an adversarial audit from the Release dashboard

**Steps:**

1. The CI/CD pipeline (`CiCdPipeline`) reaches the STAGE phase. Before the RELEASE gate opens, the `PolicyEngine` evaluates the `security_scan` gate condition: `security_scan.high_vulnerabilities == 0`. If no scan has been run, the gate blocks with `REL_GATE_BLOCKED`.
2. Operator (or automated pipeline trigger) initiates an adversarial audit from the Release dashboard (`components/governance/`). This creates a ZeroClaw task via the Hermes pipeline (see Workflow 2) with `task_type: "code_audit"` and `risk_level: "high"`.
3. `ProviderRouter` routes the code-audit task to `claude-primary` (per the role matrix: `code_audit` primary is Claude). If Claude is unavailable, fallback is `minimax-worker`.
4. The task envelope specifies `write_policy: "none"` (read-only audit), `network_policy: "limited"` (DNS + allowlisted security databases), and `allowed_workspace_scope` limited to the release branch source code.
5. ZeroClaw executes the audit in a sandboxed workspace. The audit covers: dependency vulnerability scan (CVE databases), static analysis for common vulnerability patterns, secrets detection (API keys, credentials in source), license compliance check, and code-quality regression analysis.
6. Hermes validates the audit results and writes them to the ledger. The `TaskStatus` returns with `artifacts_url` pointing to the audit report.
7. The audit report is rendered in the Release dashboard. Each finding is classified by severity (critical/high/medium/low/info). Critical and high findings block the release gate (`security_scan.high_vulnerabilities > 0` deny condition). Medium and low findings are flagged as warnings.
8. The release judge reviews the findings. For each finding, the judge can: acknowledge (accept the risk with a comment), request a fix (blocks release until resolved), or dismiss (with justification logged in audit trail).
9. Once all critical/high findings are resolved (fixed or acknowledged with Tier 3 sign-off), the `security_scan` gate condition passes. The release checklist item for `security_scan` transitions to `status: "passed"`.
10. The audit report is attached as evidence to the release `ApprovalRequest` under `evidence_paths`. The release judge can now sign off on the full release checklist, satisfying the `rollback_tested`, `security_scan`, and `truth_matrix` checklist items.

**Failure paths:**

- **Audit task times out** -> `ZC_TIMEOUT` if the codebase is very large and the audit exceeds the task timeout. Operator increases `resource_limits.timeout` and resubmits.
- **Audit provider unavailable** -> `ROUTE_NO_PROVIDER` if both `claude-primary` and `minimax-worker` are offline. The audit is queued. Release is blocked until the audit completes.
- **Critical vulnerability found** -> `REL_GATE_BLOCKED` on the `security_scan` gate. The release cannot proceed until the vulnerability is fixed. The defect ledger is updated with the finding. If the vulnerability is in a dependency, the operator can update the dependency and re-run the audit.
- **Audit integrity concern** -> If the audit results are suspected to be incomplete (e.g., ZeroClaw sandbox prevented access to all source files), `REL_GATE_BLOCKED` is maintained. The release judge must verify that `allowed_workspace_scope` covered the full release scope.

**Required subsystems:** `ReleaseService`, `PolicyEngine`, `AuthorityService`, `AuditLogger` (`services/governance/`); `HermesPipeline`, `HermesClient` (`services/hermes/`); `ProviderRouter` (`services/providers/`); Release dashboard, audit log viewer (`components/governance/`)

**Risk level:** The audit itself is low risk (read-only). Its outcome determines whether a critical-risk release can proceed.

**Approval required:** Tier 1 to initiate the audit. Tier 3 (full triad + release judge) to acknowledge a critical finding and proceed with release despite it. The release itself remains gated by the full release checklist and Tier 3 approval.

---

## Cross-Workflow Dependencies

| Workflow | Depends on |
|---|---|
| 1. SSH Connect | -- (foundational) |
| 2. ZeroClaw Submit | 4 (provider routing), 8 (approval for high-risk) |
| 3. SFTP Browse/Edit | 1 (SSH connection) |
| 4. Provider Route | -- (foundational) |
| 5. Shiba Recall | -- (independent, degrades gracefully) |
| 6. Training Launch | 4 (provider routing for remote GPU API calls) |
| 7. VPS Deploy | 1 (SSH connection), 8 (approval), 11 (Docker management) |
| 8. Approval Review | -- (governance primitive, consumed by others) |
| 9. Rollback | 7 (deploy, reversed), 8 (approval, unless emergency), 1 (SSH) |
| 10. Compare & Export | 6 (completed training jobs) |
| 11. Docker Manage | 1 (SSH connection) |
| 12. Adversarial Audit | 2 (ZeroClaw execution), 4 (provider routing), 8 (approval for findings) |

---

## Shared Error Handling Principles

All workflows follow these conventions (sourced from `ARCHITECTURE_BOUNDARIES.md`):

1. **Error codes are documented and deterministic.** Every failure path emits a named error code from the subsystem's error table. No generic "something went wrong" errors.
2. **Retryable vs. non-retryable.** Each error code specifies whether it is retryable. Retryable errors use exponential backoff (`src/util/retry.ts` pattern). Non-retryable errors require operator action.
3. **Audit trail for all outcomes.** Every workflow outcome -- success, denial, failure, timeout -- is recorded by `AuditLogger` with actor, action, result, tier, and timestamp. The audit log is append-only with hash-chain integrity.
4. **Graceful degradation.** Subsystem unavailability (Hermes offline, Shiba disconnected, VPS unreachable) does not crash the extension. Affected panels show status badges and offer retry. Unaffected workflows continue normally.
5. **Secrets never in config files.** API keys, passwords, and tokens are resolved at call time from VS Code `SecretStorage` or environment variables. Config files store only `secret://` reference URIs or env var names.
