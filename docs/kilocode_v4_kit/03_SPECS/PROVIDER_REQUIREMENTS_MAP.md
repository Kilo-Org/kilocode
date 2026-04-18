# Provider Requirements Map

Date: 2026-04-17
Version: 1.0.0
Phase: 14 of 72-phase plan
Status: Draft

References:
- `03_SPECS/KILOCODE_PROVIDER_ROUTING_COMPLETE_SPEC.md` (routing engine, lane definitions, health protocol)
- `09_CONFIG/providers.yaml` (provider registry and role matrix)
- All subsystem specs in `03_SPECS/`

---

## 1. Provider Inventory

| Provider | ID | Type | Primary Role | Capabilities | Cost per 1K Tokens (in/out) | Context Window | Priority | Tags |
|----------|----|------|-------------|-------------|---------------------------|----------------|----------|------|
| Claude (Anthropic) | `claude-primary` | Cloud | Contract, architecture, audit, verdict | `contract_writing`, `architecture_review`, `code_audit`, `verdict_generation`, `planning` | $0.003 / $0.015 | 200K | 1 | primary, high-trust |
| MiniMax | `minimax-worker` | Cloud | Execution, worker tasks, bulk processing | `code_execution`, `bulk_processing`, `worker_tasks`, `high_throughput`, `general` | $0.0004 / $0.0016 | 128K | 2 | worker, high-throughput |
| SiliconFlow | `siliconflow-overflow` | Cloud | Fallback, overflow, budget tier | `code_execution`, `bulk_processing`, `general`, `overflow`, `fallback` | $0.0002 / $0.0008 | 32K (spec) / 128K (config) | 3 | fallback, overflow, budget |
| Ollama (Local) | `ollama-local` | Local | Private data, local dev, offline | `private_data`, `local_dev`, `general`, `code_assist`, `quick_query` | $0.00 / $0.00 | Model-dependent (8K-128K) | 4 | local, private, air-gapped |
| LM Studio (Local) | `lmstudio-local` | Local | Private data, local dev, exploration | `private_data`, `local_dev`, `general`, `code_assist`, `fine_tuned_inference` | $0.00 / $0.00 | Model-dependent (4K-128K) | 5 | local, private, experimental |

### Provider Models

| Provider | Available Models | Best For |
|----------|-----------------|----------|
| Claude | claude-sonnet-4-20250514, claude-opus-4-20250514 | Deep reasoning, multi-step planning, security analysis |
| MiniMax | MiniMax-Text-01 | Fast code generation, bulk file processing |
| SiliconFlow | deepseek-ai/DeepSeek-V3, Qwen/Qwen2.5-72B-Instruct | General-purpose fallback, cost-sensitive tasks |
| Ollama | llama3.1:8b, codellama:13b, mistral:7b | Offline coding, private data queries |
| LM Studio | User-loaded models | Experimentation, fine-tuned model testing |

### Role Matrix (from config)

| Task Type | Primary Provider | Fallback Provider | Notes |
|-----------|-----------------|-------------------|-------|
| `contract_writing` | Claude | None (queue if unavailable) | Requires high-trust, large context |
| `architecture_review` | Claude | None (queue if unavailable) | Needs reasoning depth |
| `audit` | Claude | None (queue if unavailable) | Security-sensitive, no downgrade |
| `verdict` | Claude | None (queue if unavailable) | No fallback; ROUTE_NO_PROVIDER + queue |
| `code_execution` | MiniMax | SiliconFlow | High throughput preferred |
| `bulk_processing` | MiniMax | SiliconFlow | Cost-sensitive, parallelizable |
| `overflow` | SiliconFlow | MiniMax | Absorbs spike traffic |
| `local_private` | Ollama | LM Studio | Must stay local; cloud routing hard-blocked |
| `quick_query` | Ollama | Claude | Fast local answers, cloud fallback |

---

## 2. Subsystem Provider Requirements

### 2.1 SSH / Remote Systems

Spec: `KILOCODE_SSH_VPS_COMPLETE_SPEC.md` sections 1-7

| Operation | Provider Needed? | Which Provider | Why |
|-----------|-----------------|----------------|-----|
| SSH connect/disconnect | No | N/A | Direct SSH library (ssh2), no AI reasoning needed |
| SSH profile CRUD | No | N/A | YAML read/write, schema validation only |
| SSH key management | No | N/A | File system + VS Code SecretStorage |
| Jump-host proxy connect | No | N/A | ssh2 proxy-hop chain, deterministic |
| Terminal session management | No | N/A | PTY allocation over SSH channel |
| Terminal reconnect | No | N/A | Session cache + socket reconnect, no AI |
| SFTP browse/stat/read | No | N/A | Direct SFTP protocol operations |
| SFTP write/mkdir/rm/rename/chmod | No | N/A | Direct SFTP protocol operations |
| Remote file edit (diff-before-save) | No | N/A | Deterministic diff engine, no AI |
| Remote file conflict resolution | No | N/A | Three-pane merge UI, user-driven |
| Remote command suggestion | Yes | Claude or Ollama | Suggest contextually appropriate commands based on host OS, running services, and error state |
| Remote file analysis | Yes | Claude | Analyze config files (nginx, systemd, etc.) for issues; requires deep reasoning |
| Incident diagnosis from logs | Yes | Claude | Root cause analysis from error logs requires complex multi-step reasoning |
| Bulk log search/summarization | Yes | MiniMax or Ollama | Process large log volumes; MiniMax for speed, Ollama for private logs |
| Connection error guidance | No | N/A | Error classifier maps error codes to static guidance messages |
| Keep-alive monitoring | No | N/A | Timer-based packet sending, no AI |

**Summary:** SSH is primarily a protocol subsystem. Most operations are direct SSH/SFTP library calls with no AI involvement. AI providers are needed only for intelligent assistance features: command suggestion, config analysis, incident diagnosis, and log summarization.

---

### 2.2 VPS / Infrastructure

Spec: `KILOCODE_SSH_VPS_COMPLETE_SPEC.md` sections 8-11, `ARCHITECTURE_BOUNDARIES.md` section 2

| Operation | Provider Needed? | Which Provider | Why |
|-----------|-----------------|----------------|-----|
| VPS inventory CRUD | No | N/A | YAML persistence, schema validation |
| VPS status polling | No | N/A | SSH exec of system commands, metric parsing |
| CPU/RAM/disk monitoring | No | N/A | Parsing /proc/stat, /proc/meminfo, df output |
| Network I/O monitoring | No | N/A | Parsing /proc/net/dev |
| Docker container list/inspect | No | N/A | `docker ps`, `docker inspect` over SSH |
| Docker container start/stop/restart | No | N/A | `docker start/stop/restart` over SSH with approval gate |
| Docker image list/pull/remove | No | N/A | Docker CLI over SSH |
| Docker Compose up/down/ps/logs | No | N/A | `docker compose` CLI over SSH |
| Service control (systemd) | No | N/A | `systemctl` commands over SSH with approval gate |
| Provisioning (cloud-init) | No | N/A | Template rendering + VPS provider API call |
| Deploy quick-action | No | N/A | Scripted deploy pipeline over SSH |
| Metric anomaly detection | Yes | Claude or Ollama | Identify unusual patterns in CPU/RAM/disk trends |
| Capacity planning recommendation | Yes | Claude | Analyze resource trends, suggest scaling decisions |
| Incident classification | Yes | Claude | Classify failure mode from symptoms; complex reasoning |
| Recovery playbook generation | Yes | Claude | Generate step-by-step recovery based on incident context |
| Log-based root cause analysis | Yes | Claude or MiniMax | Analyze service logs for failure root cause |
| Infrastructure drift detection | Yes | MiniMax or Ollama | Compare current state vs. expected state across many nodes |
| Config file linting/review | Yes | Claude or Ollama | Review nginx/caddy/systemd configs for security and correctness |

**Summary:** Infrastructure operations are predominantly deterministic (SSH commands, Docker CLI, metric polling). AI is needed for intelligent analysis features: anomaly detection, capacity planning, incident response, and config review.

---

### 2.3 ZeroClaw Execution

Spec: `KILOCODE_ZEROCLAW_COMPLETE_SPEC.md`

| Operation | Provider Needed? | Which Provider | Why |
|-----------|-----------------|----------------|-----|
| Task envelope construction | No | N/A | JSON schema validation, deterministic field population |
| Risk classification (client-side) | Yes | Claude | Classify task risk based on type, scope, network policy, and write policy. Requires understanding of the risk escalation rules. For simple classification, can use Ollama. |
| Risk escalation (Hermes-side) | Yes | Claude | Hermes may escalate risk upward based on additional context. Requires high-trust reasoning. |
| Approval chain management | No | N/A | State machine: track signer decisions, enforce quorum |
| Task submission to Hermes | No | N/A | HTTP POST with validated envelope |
| SSE event subscription | No | N/A | EventSource client for real-time task state updates |
| Code generation in sandbox | Yes | MiniMax | Primary provider for fast code generation within sandboxed workspace. SiliconFlow as fallback. |
| Code refactoring in sandbox | Yes | MiniMax or Claude | MiniMax for straightforward refactors; Claude for complex structural changes |
| Test execution orchestration | No | N/A | ZeroClaw runs test commands, no AI needed for execution |
| Diff generation/review | Yes | Claude | Review buffered writes for correctness, security, and intent alignment |
| Artifact validation | No | N/A | Checksum verification, size checks -- deterministic |
| Rollback decision | Yes | Claude | Determine whether to auto-rollback based on failure context and execution artifacts |
| Rollback execution | No | N/A | Restore from snapshot archive -- deterministic file operations |
| Rollback verification | No | N/A | Checksum comparison against snapshot metadata |
| Workspace isolation setup | No | N/A | Mount point configuration, namespace creation -- deterministic |
| Network policy enforcement | No | N/A | iptables rules per policy -- deterministic |
| Environment variable filtering | No | N/A | Allowlist-based filtering -- deterministic |
| Secret masking in output | No | N/A | Regex-based pattern matching -- deterministic |
| Task state machine transitions | No | N/A | State machine logic, SSE event emission |

**Summary:** ZeroClaw execution is mostly plumbing (HTTP, state machines, file operations, sandboxing). AI providers are needed at three decision points: risk classification (Claude), code generation/refactoring (MiniMax), and quality review of changes (Claude).

---

### 2.4 Provider Routing (Self-Referential)

Spec: `KILOCODE_PROVIDER_ROUTING_COMPLETE_SPEC.md`

| Operation | Provider Needed? | Which Provider | Why |
|-----------|-----------------|----------------|-----|
| Provider registry CRUD | No | N/A | YAML read/write, in-memory cache |
| Health check execution | No | N/A | HTTP GET to health endpoint, latency measurement |
| Health state machine transitions | No | N/A | Deterministic: healthy -> degraded -> offline based on thresholds |
| Circuit breaker management | No | N/A | Counter-based state machine: open/half-open/closed |
| Routing decision engine | No | N/A | Deterministic filter-and-rank algorithm (sensitivity, capability, context, availability, cost, priority) |
| Fallback chain resolution | No | N/A | Ordered list traversal with status checks |
| Cost estimation per request | No | N/A | Arithmetic: token count * cost-per-token |
| Cost tracking and budget enforcement | No | N/A | Running total comparison against budget cap |
| Route trace logging | No | N/A | JSONL append to trace file |
| Provider status dashboard rendering | No | N/A | Read cached health state, render badges |
| API key validation at startup | No | N/A | Attempt auth call, check HTTP status |
| Intelligent provider selection tuning | Yes | Claude | Analyze routing traces to optimize provider selection weights, detect cost anomalies, or recommend configuration changes. Periodic, not per-request. |
| Cost anomaly detection | Yes | Claude or Ollama | Flag unusual spending patterns across sessions |

**Summary:** Provider routing is almost entirely deterministic algorithm execution. The routing decision engine, health checks, and cost tracking require no AI. AI is only useful for periodic meta-analysis of routing efficiency and cost patterns.

---

### 2.5 Memory / Shiba

Spec: `KILOCODE_MEMORY_COMPLETE_SPEC.md`

| Operation | Provider Needed? | Which Provider | Why |
|-----------|-----------------|----------------|-----|
| Shiba WebSocket connect/reconnect | No | N/A | WebSocket client with exponential backoff |
| Memory entry write | No | N/A | Structured write to Shiba backend |
| Memory entry read (by key) | No | N/A | Direct key lookup, no AI needed |
| Write queue management (offline) | No | N/A | Local FIFO queue, drain on reconnect |
| Dead letter handling | No | N/A | Move failed writes to dead_letter.jsonl |
| Checksum integrity verification | No | N/A | SHA-256 comparison -- deterministic |
| Project scope enforcement | No | N/A | Namespace prefix check -- deterministic |
| Cross-agent permission check | No | N/A | Permission matrix lookup -- deterministic |
| Audit trail logging | No | N/A | JSONL append with structured fields |
| Recall query (semantic search) | Yes | Claude or Ollama | Rank and score memory entries by semantic relevance to a natural-language query. Shiba may handle this internally, but if client-side ranking is needed, an LLM helps. |
| Memory summarization | Yes | Claude or MiniMax | Condense many memory entries into a coherent summary for context injection. Claude for quality, MiniMax for speed on large entry sets. |
| Context injection (agent context building) | Yes | Claude or MiniMax | Select and format relevant memories to inject into an agent's context window. Requires understanding which memories are relevant to the current task. |
| Memory conflict resolution (merge strategy) | No | N/A | Deep-merge algorithm for objects; concat+dedup for arrays -- deterministic |
| Corrupted entry rollback | No | N/A | Restore previous version from version chain |
| Recall cache management | No | N/A | LRU eviction, max 50MB -- deterministic |
| Quota enforcement | No | N/A | Counter checks against config limits |

**Summary:** Memory is a storage subsystem with most operations being direct reads/writes to Shiba. AI providers are needed for three intelligence features: semantic recall ranking, memory summarization, and context injection assembly.

---

### 2.6 Training / GPU

Spec: `KILOCODE_TRAINING_GPU_COMPLETE_SPEC.md`

| Operation | Provider Needed? | Which Provider | Why |
|-----------|-----------------|----------------|-----|
| Dataset registration | No | N/A | File metadata extraction, YAML persistence |
| Dataset validation (schema check) | No | N/A | Format parsing, column type verification -- deterministic |
| Dataset validation (duplicate detection) | No | N/A | SHA-256 row hashing -- deterministic |
| Dataset validation (null/empty scan) | No | N/A | Column-level counting -- deterministic |
| Dataset validation (format normalization) | No | N/A | Whitespace stripping, Unicode NFC, line ending conversion -- deterministic |
| Dataset split (train/val/test) | No | N/A | Stratified random split with configurable seed |
| Local GPU detection | No | N/A | `nvidia-smi` command parsing |
| Remote GPU provider query | No | N/A | REST API call to RunPod/Lambda/Vast.ai |
| GPU auto-select (VRAM estimation) | No | N/A | Arithmetic formula based on model params and method |
| Training job launch | No | N/A | Hyperparameter config + training script invocation |
| Training monitoring (loss/metrics) | No | N/A | Structured event emission at each step |
| Checkpoint save/verify | No | N/A | File write + SHA-256 checksum |
| Checkpoint resume | No | N/A | Load weights + optimizer state from checkpoint |
| Early stopping | No | N/A | Patience counter on val_loss improvement |
| Model export (GGUF/safetensors/ONNX) | No | N/A | Format conversion pipeline -- deterministic |
| Hyperparameter suggestion | Yes | Claude | Recommend optimal hyperparameters based on dataset characteristics, model architecture, and available hardware. Requires understanding of training dynamics. |
| Training result analysis | Yes | Claude or MiniMax | Interpret loss curves, identify overfitting/underfitting, explain metric trends |
| Run comparison and recommendation | Yes | Claude | Compare multiple training runs and recommend the best configuration. Requires reasoning across multiple metric dimensions. |
| Dataset quality assessment | Yes | Claude or Ollama | Beyond schema checks: assess whether dataset content is suitable for the intended training goal |
| Training failure diagnosis | Yes | Claude | Analyze OOM errors, CUDA failures, and gradient issues; suggest concrete fixes |
| Model evaluation report generation | Yes | Claude or MiniMax | Generate human-readable reports summarizing model performance, strengths, and weaknesses |

**Summary:** The training pipeline is heavily deterministic (data processing, GPU management, checkpoint I/O, format conversion). AI providers add value at the advisory layer: hyperparameter tuning, result interpretation, run comparison, and failure diagnosis.

---

### 2.7 Governance / Release

Spec: `KILOCODE_GOVERNANCE_RELEASE_COMPLETE_SPEC.md`

| Operation | Provider Needed? | Which Provider | Why |
|-----------|-----------------|----------------|-----|
| Authority tier lookup | No | N/A | Config-driven tier-to-action mapping |
| Approval request creation | No | N/A | Structured record creation |
| Approval flow management | No | N/A | State machine: pending -> approved/denied/expired |
| Approval timeout enforcement | No | N/A | Timer-based expiry check |
| Dangerous action registry lookup | No | N/A | Config-driven deny/gate condition evaluation |
| Deny condition evaluation | No | N/A | Expression evaluation against system state |
| Gate condition evaluation | No | N/A | Expression evaluation against CI/test results |
| Cooldown enforcement | No | N/A | Timestamp comparison |
| Audit record creation | No | N/A | Structured JSONL append |
| Audit log integrity check | No | N/A | SHA-256 hash chain verification |
| CI/CD pipeline orchestration | No | N/A | Stage sequencing, artifact collection, gate checks |
| Lint stage execution | No | N/A | ESLint/Prettier/tsc invocation |
| Test stage execution | No | N/A | Vitest invocation, pass rate calculation |
| Build stage execution | No | N/A | esbuild/vite invocation |
| Package stage execution | No | N/A | VSIX packaging, integrity check |
| Release gate evaluation | No | N/A | Checklist status aggregation |
| Rollback execution | No | N/A | Artifact swap, container image tag update |
| Rollback verification | No | N/A | Health endpoint checks, smoke tests |
| Post-release monitoring | No | N/A | Error rate, crash rate threshold checks |
| Audit analysis and reporting | Yes | Claude | Analyze audit trail patterns for anomalies, unauthorized access attempts, or policy gaps. Periodic, not per-action. |
| Release readiness assessment | Yes | Claude | Synthesize signals from tests, security scans, defect ledger, and performance benchmarks into a holistic release readiness verdict. Requires multi-factor reasoning. |
| Security review summary | Yes | Claude | Interpret security scan results, prioritize findings, generate actionable remediation guidance |
| Incident root cause analysis | Yes | Claude | Analyze post-release monitoring data + logs to determine root cause of production issues |
| Compliance report generation | Yes | Claude or MiniMax | Generate formatted compliance and governance reports from audit data |
| Defect trend analysis | Yes | Claude or MiniMax | Analyze defect ledger trends over time, identify systemic patterns |

**Summary:** Governance and release workflows are rules-based systems with deterministic state machines, approval flows, and CI/CD orchestration. AI providers are needed for analytical functions: audit analysis, release readiness synthesis, security review interpretation, and incident analysis.

---

### 2.8 Speech / TTS (Existing -- Complete)

Spec: `KILOCODE_SPEECH_COMPLETE_SPEC.md`

| Operation | Provider Needed? | Which Provider | Why |
|-----------|-----------------|----------------|-----|
| Text-to-speech synthesis | No | N/A (dedicated TTS APIs) | Uses speech-specific providers (Azure TTS, Google TTS, OpenAI TTS, ElevenLabs, Polly, browser Web Speech API). These are NOT LLM providers. |
| Provider registry management | No | N/A | Map-based registry, register/get/list/listByTier |
| Voice list retrieval | No | N/A | Per-provider voice catalog, no AI |
| Audio playback (AudioContext) | No | N/A | Browser audio APIs |
| LRU synthesis cache | No | N/A | 32-entry cache, deterministic eviction |
| Text filter/sanitization | No | N/A | 25-rule regex-based pipeline for stripping markdown, code blocks, URLs |
| Sentiment detection | No | N/A | Keyword-matching, rule-based pitch/rate adjustment |
| Voice fine-tuning (pitch/rate/emphasis) | No | N/A | Direct parameter passing to TTS API |
| Auto-speak toggle | No | N/A | Boolean config, event listener |
| Stop-on-typing | No | N/A | Keydown event listener |
| CSP endpoint management | No | N/A | Static allowlist in connect-src |
| Provider connection test | No | N/A | HTTP request to provider API with test payload |

**Summary:** Speech is entirely independent of LLM providers. It uses dedicated TTS cloud APIs and browser audio APIs. All text processing (filtering, sentiment) is rule-based. No AI provider involvement whatsoever.

---

## 3. Cross-Cutting Provider Needs

These operations span multiple subsystems and have shared provider requirements.

| Cross-Cutting Operation | Subsystems Involved | Provider | Why |
|------------------------|---------------------|----------|-----|
| Natural language task interpretation | ZeroClaw, SSH, VPS | Claude | Parse user intent from natural language into structured task parameters |
| Code review and quality assessment | ZeroClaw, Governance | Claude | Review generated or modified code for correctness, security, and style |
| Error/log analysis | SSH, VPS, ZeroClaw, Training, Governance | Claude or MiniMax | Interpret error messages, log patterns, stack traces across subsystems |
| Context window assembly | Memory, ZeroClaw | Claude or MiniMax | Select and format relevant context (memories, project state) for agent tasks |
| Report generation | Training, Governance | Claude or MiniMax | Generate structured, human-readable reports from data |
| Cost optimization recommendations | Provider Routing, Training | Claude | Analyze usage patterns and suggest cost-saving configurations |
| Private/sensitive data processing | SSH (private keys analysis), Memory (restricted scope) | Ollama or LM Studio | Process data that must never leave the local machine |

---

## 4. Provider Budget Planning

Based on the role matrix and expected operation frequency per usage scenario.

### Cost Model Reference

| Provider | Input (per 1K tokens) | Output (per 1K tokens) | Typical Request (5K in / 2K out) |
|----------|----------------------|------------------------|----------------------------------|
| Claude | $0.003 | $0.015 | $0.045 |
| MiniMax | $0.0004 | $0.0016 | $0.0052 |
| SiliconFlow | $0.0002 | $0.0008 | $0.0026 |
| Ollama | $0.00 | $0.00 | $0.00 |
| LM Studio | $0.00 | $0.00 | $0.00 |

### Usage Scenarios

| Scenario | Claude Requests/mo | MiniMax Requests/mo | SiliconFlow Requests/mo | Total Tokens | Estimated Cost |
|----------|-------------------|--------------------|-----------------------|--------------|----------------|
| **Light (solo dev)** | 100 | 200 | 50 | ~2.5M | $8-15 |
| Task breakdown: risk classification (20), code review (30), architecture review (10), diagnosis (20), misc (20) | code gen (150), bulk processing (30), log analysis (20) | overflow (50) | | |
| **Medium (small team, 3 devs)** | 400 | 800 | 200 | ~10M | $30-60 |
| Task breakdown: risk classification (80), code review (120), architecture (40), incident diagnosis (60), audit analysis (40), release readiness (20), misc (40) | code gen (500), refactoring (100), bulk processing (100), log analysis (100) | overflow (200) | | |
| **Heavy (CI/CD + agents)** | 1,500 | 5,000 | 1,000 | ~50M | $120-250 |
| Task breakdown: continuous code review (500), risk classification (300), architecture/audit (200), governance (150), incident/diagnosis (150), misc (200) | code gen (3,000), bulk processing (1,000), log analysis (500), reports (500) | overflow/fallback (1,000) | | |
| **Enterprise (multi-project + training)** | 5,000 | 15,000 | 5,000 | ~175M | $400-800 |
| All heavy scenario tasks scaled 3x + training advisory (hyperparameter tuning, result analysis, model comparison) | All heavy scenario tasks scaled 3x + training data processing | All heavy scenario tasks scaled 5x | | |

### Daily Budget Caps (from config)

| Setting | Value |
|---------|-------|
| `cost_tracking.budget_alert_threshold_usd` | $10.00 |
| `cost_tracking.daily_cap_usd` | $50.00 |

---

## 5. Offline / Local-Only Mode

When all cloud providers are unavailable (network outage, air-gapped environment, or deliberate offline choice), the following operations remain functional with Ollama or LM Studio.

### Fully Functional (no provider needed)

These operations work without any AI provider, cloud or local.

| Subsystem | Operations |
|-----------|-----------|
| SSH | All connection, terminal, SFTP, and file operations |
| VPS | All monitoring, Docker/Compose control, service management |
| ZeroClaw | Task envelope construction, approval flow, workspace isolation, rollback execution, artifact validation |
| Provider Routing | Health checks, routing decisions, cost tracking, trace logging |
| Memory | All read/write/recall-by-key, queue management, integrity checks, audit |
| Training | Dataset registration/validation, GPU detection, job launch/monitor/checkpoint, export |
| Governance | All approval flows, audit logging, CI/CD pipeline execution, release gates, rollback |
| Speech | All TTS (browser provider works offline; cloud TTS providers require network but are not LLM providers) |

### Functional with Local Provider (Ollama / LM Studio)

| Operation | Quality vs. Cloud | Notes |
|-----------|------------------|-------|
| Command suggestion (SSH) | Moderate | Smaller models give adequate but less nuanced suggestions |
| Config file review | Moderate | Can identify common misconfigurations; misses subtle issues |
| Log summarization | Good | Bulk text processing works well with local models |
| Basic risk classification | Moderate | Can handle straightforward classification; complex edge cases may misclassify |
| Simple code generation | Moderate | Works for boilerplate and standard patterns; quality drops for complex logic |
| Memory recall (semantic) | Moderate | Depends on embedding quality of local model |
| Memory summarization | Moderate | Adequate for short summaries; loses nuance on large entry sets |
| Hyperparameter suggestion | Limited | Smaller models lack depth for training optimization advice |
| Metric anomaly detection | Moderate | Can flag obvious anomalies; misses subtle patterns |
| Quick query answering | Good | Fast, free, and adequate for straightforward questions |

### Degraded or Unavailable Offline

| Operation | Why It Degrades | Impact |
|-----------|----------------|--------|
| Architecture review | Requires deep multi-step reasoning; local models lack capacity | Must queue for when Claude is back online |
| Contract writing | High-trust, large-context work; local models insufficient | Must queue |
| Verdict generation | No fallback by design; queued with ROUTE_NO_PROVIDER | Governance decisions stall |
| Security review summary | Requires nuanced security knowledge | Reduced to manual review |
| Release readiness assessment | Multi-factor synthesis exceeds local model capability | Must assess manually |
| Complex incident diagnosis | Root cause analysis on complex systems needs deep reasoning | Reduced to basic log search |
| Training failure diagnosis (OOM, CUDA) | Requires specific technical knowledge about GPU/training dynamics | Generic suggestions only |
| Code quality review (diff review) | Local models may miss security issues or subtle bugs | Accept risk or queue for cloud review |

### Local-Only Provider Selection

| Scenario | Recommended Local Provider | Model | Why |
|----------|---------------------------|-------|-----|
| Code-related tasks | Ollama | codellama:13b | Optimized for code understanding and generation |
| General queries | Ollama | llama3.1:8b | Best general-purpose local model |
| Fast iteration | Ollama | mistral:7b | Fastest inference, adequate quality |
| Model exploration | LM Studio | User-loaded | GUI allows easy model comparison |
| Fine-tuned model serving | LM Studio | Custom fine-tuned | Load exported GGUF models from Training subsystem |

---

## 6. Provider Failure Impact Analysis

### Single Provider Failure

| Provider Goes Down | Affected Operations | Impact Severity | Mitigation |
|-------------------|---------------------|----------------|------------|
| **Claude offline** | Architecture review, contract writing, audit, verdict, risk classification, diff review, release readiness, security review, incident diagnosis | **High** | (1) Queue verdict/contract/architecture tasks with ROUTE_NO_PROVIDER notification. (2) Fall back to SiliconFlow for simple code review. (3) Fall back to Ollama for basic risk classification. (4) Governance release decisions must wait. |
| **MiniMax offline** | Code generation, bulk processing, high-throughput worker tasks | **Medium** | (1) Fall back to SiliconFlow for all code_execution and bulk_processing tasks. (2) Reduced throughput but functionality preserved. (3) Cost increases slightly (SiliconFlow is cheaper per token but may need more tokens due to smaller context). |
| **SiliconFlow offline** | Overflow absorption, budget-tier fallback | **Low** | (1) MiniMax absorbs overflow traffic. (2) Cost increases since MiniMax is 2x more expensive per token. (3) If MiniMax is also at capacity, queue with backpressure. |
| **Ollama offline** | Local/private data processing, quick queries, offline mode | **Low-Medium** | (1) Fall back to LM Studio if available. (2) If both local providers offline, private_data tasks are blocked (cannot route to cloud). (3) Non-private tasks route to cloud providers. |
| **LM Studio offline** | Model exploration, fine-tuned model serving | **Low** | (1) Fall back to Ollama for local tasks. (2) LM Studio is experimental/secondary; minimal operational impact. |

### Multi-Provider Failure

| Failure Scenario | Impact | Mitigation |
|-----------------|--------|------------|
| **Claude + MiniMax offline** | No high-trust reasoning AND no fast code generation. Critical gap. | SiliconFlow handles code execution (degraded quality). Architecture/audit/verdict tasks queued. Ollama provides local fallback for simple tasks. |
| **All cloud providers offline** | No cloud AI capabilities. Only local providers available. | Enter local-only mode. See section 5 for capability matrix. Queue all high-trust tasks. Alert operator. |
| **All local providers offline** | No local/private data processing. No offline capability. | Cloud providers handle all non-private tasks normally. Private data tasks blocked with MEM_SCOPE_DENIED. Alert user to start Ollama. |
| **All providers offline** | Complete AI capability loss. | All subsystem operations that require AI providers are unavailable. All deterministic operations (SSH, SFTP, monitoring, CI/CD, approvals, etc.) continue normally. Queue all AI-dependent tasks. Alert operator for manual intervention. |

### Recovery Priority

When multiple providers recover simultaneously, process queued tasks in this order:

| Priority | Task Type | Provider | Reason |
|----------|-----------|----------|--------|
| 1 | `verdict_generation` | Claude | Unblocks governance decisions |
| 2 | `code_audit` | Claude | Security-sensitive, may block releases |
| 3 | `architecture_review` | Claude | May block design decisions |
| 4 | `contract_writing` | Claude | Documentation backlog is tolerable |
| 5 | `code_execution` (queued) | MiniMax | Resume execution pipeline |
| 6 | `bulk_processing` (queued) | MiniMax | Catch up on backlog |
| 7 | `overflow` (queued) | SiliconFlow | Drain overflow buffer |

---

## 7. Data Sensitivity Routing Constraints

The routing decision engine enforces data sensitivity rules (from the provider routing spec, section 4). These constraints override all other routing preferences.

| Data Sensitivity | Eligible Provider Types | Blocked Provider Types | Enforcement |
|-----------------|------------------------|----------------------|-------------|
| `public` | Cloud + Local (all) | None | Standard routing |
| `internal` | Cloud (high-trust tagged only) + Local | Cloud without `high-trust` tag | Filter step 1 of routing algorithm |
| `confidential` | Local only | All cloud providers | Hard block in routing engine |
| `restricted` | Local only | All cloud providers | Hard block in routing engine |

### Subsystem Data Sensitivity Defaults

| Subsystem | Typical Data Sensitivity | Default Eligible Providers |
|-----------|-------------------------|---------------------------|
| SSH (connection data) | internal | Claude, Ollama, LM Studio |
| SSH (private keys) | restricted | Ollama, LM Studio only |
| VPS (infrastructure state) | internal | Claude, Ollama, LM Studio |
| VPS (monitoring metrics) | public | All providers |
| ZeroClaw (task context) | internal | Claude, MiniMax (high-trust), Ollama |
| ZeroClaw (code under review) | varies per project | Depends on project classification |
| Memory (global scope) | internal | Claude, Ollama, LM Studio |
| Memory (project scope) | varies per project | Depends on project classification |
| Training (datasets) | varies | Public datasets: all providers. Private datasets: local only |
| Training (model weights) | confidential | Ollama, LM Studio only |
| Governance (audit logs) | internal | Claude, Ollama, LM Studio |
| Governance (security scans) | confidential | Ollama, LM Studio only |
| Speech | public | N/A (no LLM providers used) |

---

## 8. Provider Capacity Planning

### Concurrency Limits (from provider specs)

| Provider | Requests/min | Tokens/min | Concurrent Requests |
|----------|-------------|-----------|-------------------|
| Claude | 60 | 100,000 | 10 |
| MiniMax | 120 | 500,000 | 50 |
| SiliconFlow | 200 | 1,000,000 | 100 |
| Ollama | Unlimited | Unlimited | 1 (single GPU) |
| LM Studio | Unlimited | Unlimited | 1 (single GPU) |

### Bottleneck Analysis

| Scenario | Bottleneck | Symptom | Resolution |
|----------|-----------|---------|------------|
| Heavy CI/CD with many code reviews | Claude rate limit (60 req/min) | ROUTE_RATE_LIMITED errors, queue growth | Batch code review requests; defer non-critical reviews to MiniMax |
| Bulk dataset processing | Ollama concurrency (1) | Long queue times for local tasks | Route to MiniMax if data is not restricted; or use Ollama queue with priority ordering |
| Multiple parallel agents | MiniMax concurrent limit (50) | Requests rejected or delayed | SiliconFlow overflow absorbs excess; scale to multi-instance MiniMax if persistent |
| Large context requests (>128K tokens) | Only Claude supports >128K | ROUTE_CONTEXT_EXCEEDED on MiniMax/SiliconFlow | Must use Claude; if Claude is at capacity, queue or truncate context |
| Spike traffic (release day) | All providers under load | Degraded latency across the board | SiliconFlow (200 req/min, 100 concurrent) absorbs spikes; circuit breakers prevent cascade |

---

## 9. Provider Requirements Summary by Subsystem

| Subsystem | Requires LLM Provider? | Primary Provider Used | Fallback Provider | % of Operations Needing AI | Key AI-Dependent Operations |
|-----------|----------------------|----------------------|-------------------|--------------------------|---------------------------|
| SSH / Remote | Partially | Claude, Ollama | MiniMax (for logs) | ~15% | Command suggestion, config analysis, incident diagnosis |
| VPS / Infrastructure | Partially | Claude, Ollama | MiniMax | ~20% | Anomaly detection, capacity planning, incident response |
| ZeroClaw Execution | Yes (critical path) | Claude + MiniMax | SiliconFlow | ~30% | Risk classification, code generation, diff review |
| Provider Routing | Minimal | Claude (periodic) | Ollama | ~5% | Routing optimization analysis, cost anomaly detection |
| Memory / Shiba | Partially | Claude, MiniMax | Ollama | ~20% | Semantic recall, summarization, context injection |
| Training / GPU | Partially | Claude | MiniMax | ~25% | Hyperparameter suggestion, result analysis, comparison |
| Governance / Release | Partially | Claude | MiniMax | ~15% | Audit analysis, release readiness, security review |
| Speech / TTS | No | N/A | N/A | 0% | None -- uses dedicated TTS APIs, not LLM providers |

---

## 10. Acceptance Criteria for This Map

1. Every subsystem from the architecture boundaries spec has a dedicated requirements table.
2. Each operation within each subsystem is categorized as provider-needed or not-needed, with justification.
3. The role matrix from `providers.yaml` is reflected accurately in all provider assignments.
4. Data sensitivity routing constraints are documented per subsystem.
5. Offline/local-only mode capabilities are mapped with quality assessments.
6. Single-provider and multi-provider failure scenarios are analyzed with mitigations.
7. Budget estimates cover four usage tiers (light, medium, heavy, enterprise).
8. Concurrency bottlenecks are identified with resolution strategies.
9. The summary table (section 9) gives a quick-reference view of provider dependency per subsystem.
10. No provider is assigned to an operation it cannot support per the capability matrix.
