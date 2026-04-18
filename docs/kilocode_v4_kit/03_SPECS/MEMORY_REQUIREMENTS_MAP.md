# Memory Requirements Map

Date: 2026-04-17
Phase: 15 of 72-phase plan
Depends on: `KILOCODE_MEMORY_COMPLETE_SPEC.md`, `ARCHITECTURE_BOUNDARIES.md`, all subsystem specs
Config: `09_CONFIG/memory.yaml`

---

## Memory Architecture Overview

Shiba is the continuity and recall layer. It stores facts, context, and history that agents and subsystems need across sessions. Every persisted memory entry conforms to the `MemoryEntry` schema (UUID, project scope, agent ID, key, value, TTL, checksum, version). Entries are namespaced as `project:{project_id}:{key}` or `__global__:{key}`.

This document maps what each subsystem needs to **remember**, **recall**, and **share** -- and the concrete Shiba keys, sizes, and triggers involved.

### Scope Definitions

| Scope | Meaning | Lifetime |
|-------|---------|----------|
| `global` | Visible to all projects and agents | Until TTL or manual delete |
| `project` | Scoped to one project (path hash) | Until TTL or project removal |
| `session` | Scoped to one active session | Auto-deleted on session end |

### Agent IDs Used

| Agent ID | Subsystem |
|----------|-----------|
| `kilocode-core` | Core extension, KiloProvider |
| `ssh-agent` | SSH / Remote Systems |
| `vps-agent` | VPS / Infrastructure |
| `zeroclaw` | ZeroClaw Execution (via Hermes) |
| `router-agent` | Provider Routing |
| `training-agent` | Training / GPU |
| `governance-agent` | Governance / Release |
| `speech-agent` | Speech / TTS |

---

## Subsystem Memory Requirements

### 1. SSH / Remote Systems

| What to Remember | Key Pattern | Scope | Write Trigger | Recall Trigger | TTL | Priority | Value Type |
|-----------------|-------------|-------|---------------|----------------|-----|----------|------------|
| SSH host connection history | `ssh.connections.{profileId}` | project | Successful connect (state -> `connected`) | Host selection in sidebar, reconnect | 90d | Medium | `{host, port, username, connectedAt, disconnectedAt, durationMs, authMethod}` |
| Last used commands per host | `ssh.commands.{profileId}` | project | Command execution in terminal session | Terminal open for this host | 30d | Low | `string[]` (last 50 commands) |
| Failed auth attempts | `ssh.auth_failures.{host}` | global | `SSH_AUTH_FAILED` or `SSH_KEY_INVALID` event | Connection retry, security audit | 7d | High | `{host, username, authMethod, failedAt, reason, consecutiveCount}` |
| Remote file edit history | `ssh.edits.{profileId}` | project | SFTP write confirm (step 7 of edit flow) | File open in remote tree, recent files list | 30d | Medium | `{path, editedAt, sizeBytes, checksum}[]` (last 100) |
| Host health snapshots | `ssh.health.{profileId}` | project | Monitoring poll (30s default interval) | Dashboard load, VPS overview panel | 24h | Medium | `monitoringSample` (cpu, ram, disk, network, uptime) |
| Known host fingerprints | `ssh.fingerprints.{host}:{port}` | global | First successful connect to new host | Every connection handshake | permanent | Critical | `{fingerprint, algorithm, firstSeen, lastSeen}` |
| Terminal session metadata | `ssh.sessions.{sessionId}` | session | Session open (PTY allocated) | Session resume after suspend | session | Low | `{profileId, shellPath, cols, rows, createdAt, lastActivity}` |
| Reconnect outcomes | `ssh.reconnects.{profileId}` | project | Reconnect success or `SSH_HOST_UNREACHABLE` | Adaptive backoff tuning, reliability dashboard | 14d | Low | `{attemptedAt, succeeded, attemptsUsed, maxAttempts, latencyMs}` |

### 2. VPS / Infrastructure

| What to Remember | Key Pattern | Scope | Write Trigger | Recall Trigger | TTL | Priority | Value Type |
|-----------------|-------------|-------|---------------|----------------|-----|----------|------------|
| Service restart history | `vps.restarts.{vpsId}.{serviceName}` | project | `docker restart` or `systemctl restart` confirmed | Service status view, incident review | 90d | High | `{restartedAt, restartedBy, previousState, resultState, durationMs}[]` |
| Deploy outcomes | `vps.deploys.{vpsId}` | project | `docker compose up` or deploy script completes | Deploy dashboard, rollback decision | 180d | High | `{deployId, image, tag, startedAt, status, exitCode, artifactChecksums}` |
| Incident timeline | `vps.incidents.{vpsId}` | project | Service enters `failed` state, health check exceeds threshold | Incident review panel, post-mortem | 365d | Critical | `{incidentId, detectedAt, resolvedAt, service, trigger, actions[]}` |
| VPS inventory snapshots | `vps.inventory.{vpsId}` | project | Inventory poll or manual refresh | Instance list, provision wizard defaults | 7d | Medium | `{cpu, ram, disk, os, provider, region, status, services[]}` |
| Backup schedule records | `vps.backups.{vpsId}` | project | Backup script execution | Backup status dashboard, restore options | 90d | High | `{backupId, createdAt, sizeBytes, path, verified, retention}` |
| Performance baselines | `vps.baselines.{vpsId}` | project | Computed after 7 days of monitoring data | Anomaly detection threshold, alerting | 30d | Medium | `{cpuP50, cpuP95, ramP50, ramP95, diskIoP95, networkP95}` |
| Docker image inventory | `vps.images.{vpsId}` | project | `docker images` list result | Image cleanup decisions, deploy history | 7d | Low | `{repository, tag, id, size, created}[]` |
| Cost tracking per instance | `vps.costs.{vpsId}` | project | Hourly cost accumulation tick | Budget dashboard, cost report | 90d | Medium | `{date, provider, instanceType, hoursRunning, costUsd}` |

### 3. ZeroClaw Execution

| What to Remember | Key Pattern | Scope | Write Trigger | Recall Trigger | TTL | Priority | Value Type |
|-----------------|-------------|-------|---------------|----------------|-----|----------|------------|
| Task execution outcomes | `zeroclaw.tasks.{taskId}` | project | SSE event: `completed`, `failed`, `rolled_back` | Task history timeline, retry decision | 90d | High | `{taskId, taskType, riskLevel, status, startedAt, finishedAt, exitCode, durationMs, artifactCount}` |
| Risk assessment history | `zeroclaw.risk.{projectId}` | project | Risk classification computed (section 2 of spec) | Risk pattern analysis, auto-classification tuning | 180d | Medium | `{taskType, computedRisk, hermesOverride, scope, networkPolicy, writePolicy}` |
| Approved execution patterns | `zeroclaw.approved_patterns` | project | Task with `approval_chain` fully approved | Pre-fill approval chain for similar tasks | 180d | Medium | `{taskType, riskLevel, scope, networkPolicy, signers[], approvedAt}` |
| Rejected / denied patterns | `zeroclaw.denied_patterns` | project | `ZC_APPROVAL_DENIED` or signer denial | Warn user before submitting similar task | 90d | High | `{taskType, riskLevel, deniedBy, reason, deniedAt}` |
| Rollback history | `zeroclaw.rollbacks.{taskId}` | project | Rollback state -> `rolled_back` or `ZC_ROLLBACK_FAILED` | Rollback reliability tracking, incident review | 180d | Critical | `{taskId, snapshotId, trigger, filesRestored, status, verificationPassed}` |
| Workspace resource usage | `zeroclaw.resources.{taskId}` | project | Job response `resource_usage` received | Resource limit tuning, GPU sizing | 30d | Low | `{peakCpuPercent, peakMemoryMb, diskUsedMb, durationMs}` |
| Policy violation log | `zeroclaw.violations` | global | `ZC_POLICY_VIOLATION` or `ZC_NETWORK_BLOCKED` | Security audit, policy refinement | 365d | Critical | `{taskId, violationType, detail, blockedAt, agentId}` |
| Artifact checksums | `zeroclaw.artifacts.{taskId}` | project | Artifact return from ZeroClaw | Artifact integrity verification on re-download | 30d | Medium | `{artifactId, type, path, checksum, sizeBytes, mimeType}[]` |

### 4. Provider Routing

| What to Remember | Key Pattern | Scope | Write Trigger | Recall Trigger | TTL | Priority | Value Type |
|-----------------|-------------|-------|---------------|----------------|-----|----------|------------|
| Route decisions | `routing.decisions.{traceId}` | project | Every routing decision (section 4 of spec) | Route trace panel, audit, debugging | 90d | Medium | `{traceId, taskType, actualProvider, model, fallbackUsed, fallbackDepth, reasoning}` |
| Fallback events | `routing.fallbacks` | global | Primary provider unavailable, fallback selected | Provider reliability dashboard, alerting config | 30d | High | `{timestamp, primaryProvider, fallbackProvider, reason, taskType, latencyMs}` |
| Provider latency history | `routing.latency.{providerId}` | global | Every completed request to a provider | Routing decision engine (rank by latency), health panel | 7d | Medium | `{timestamp, latencyMs, status, tokensUsed, model}` |
| Cost accumulation per provider | `routing.costs.{providerId}` | project | Token usage computed after each request | Budget enforcement, cost dashboard, daily cap check | 90d | High | `{date, inputTokens, outputTokens, costUsd, requestCount}` |
| Provider error rates | `routing.errors.{providerId}` | global | Any error response from provider (4xx, 5xx, timeout) | Circuit breaker state, health check, routing rank | 7d | High | `{timestamp, errorCode, httpStatus, retryable, taskType}` |
| Circuit breaker state | `routing.circuit.{providerId}` | global | State transition (closed->open, open->half_open, etc.) | Routing decision filter step 4 | 1d | Critical | `{state, openedAt, consecutiveFailures, lastSuccess, halfOpenAt}` |
| Session cost total | `routing.session_cost.{sessionId}` | session | After each billable request | Budget check before next request, session summary | session | High | `{totalCostUsd, requestCount, inputTokens, outputTokens}` |
| Provider health history | `routing.health.{providerId}` | global | Health check poll (60s interval) | Health status panel, historical uptime | 30d | Medium | `{timestamp, status, latencyMs, consecutiveFailures, circuitState}` |

### 5. Training / GPU

| What to Remember | Key Pattern | Scope | Write Trigger | Recall Trigger | TTL | Priority | Value Type |
|-----------------|-------------|-------|---------------|----------------|-----|----------|------------|
| Dataset metadata | `training.datasets.{datasetId}` | project | Dataset registered via DatasetService | Dataset browser, training job creation form | permanent | High | `{datasetId, name, format, sizeBytes, rowCount, columns[], validationStatus, fingerprint, splits}` |
| Training run records | `training.jobs.{jobId}` | project | Job status -> `completed` or `failed` | Job history, compare runs, export picker | 180d | High | `{jobId, datasetId, modelBase, method, hyperparams, status, duration, finalTrainLoss, finalValLoss, bestValLoss, totalCostUsd, gpuType}` |
| Hyperparameter configs | `training.hyperparams.{jobId}` | project | Job submitted with custom hyperparams | Pre-fill form for new job based on best run | 180d | Medium | Full `Hyperparams` object (learning_rate, epochs, batch_size, lora_r, etc.) |
| Model performance metrics | `training.metrics.{jobId}` | project | Each MonitoringEvent (every `log_interval_steps`) | Training dashboard, loss curve rendering, compare runs | 90d | Medium | `{epoch, step, loss, valLoss, learningRate, gpuUtil, vramUsed, throughput}` |
| Export history | `training.exports.{exportId}` | project | Export status -> `completed` | Export browser, model deployment picker | 180d | High | `{exportId, jobId, checkpointId, format, quantization, sizeBytes, outputPath, metadata}` |
| GPU availability snapshots | `training.gpu.local` | global | `nvidia-smi` detection on activation | GPU target selection auto-select logic | 1d | Medium | `{detected, gpuName, vramTotalMb, vramAvailableMb, cudaVersion, driverVersion}` |
| Remote GPU pricing | `training.gpu.remote.{provider}` | global | Price query to RunPod/Lambda/Vast.ai | Cost estimation for GPU selection | 1d | Low | `{gpuType, vramMb, costPerHour, availability, region}[]` |
| Checkpoint inventory | `training.checkpoints.{jobId}` | project | Checkpoint saved at `checkpoint_interval_steps` | Resume from checkpoint, export from best checkpoint | 90d | High | `{checkpointId, epoch, step, path, sizeBytes, trainLoss, valLoss, isBest, resumable, checksum}` |
| Run comparison results | `training.comparisons.{comparisonId}` | project | User triggers compare of 2+ runs | Re-view comparison, recommendation recall | 90d | Low | `{runIds[], bestRunId, bestMetricKey, bestMetricValue, recommendation}` |
| Dataset validation reports | `training.validation.{datasetId}` | project | Validation pipeline completes (all 6 stages) | Dataset detail view, fix guidance | 30d | Medium | `{validationStatus, issues[], duplicateCount, nullReport, normalizationReport, splitStats}` |

### 6. Governance / Release

| What to Remember | Key Pattern | Scope | Write Trigger | Recall Trigger | TTL | Priority | Value Type |
|-----------------|-------------|-------|---------------|----------------|-----|----------|------------|
| Approval decisions | `governance.approvals.{requestId}` | project | Approver submits decision (approved/denied) | Approval audit trail, re-submission context | 365d | Critical | `{requestId, actionType, riskLevel, requiredTier, requestedBy, approvers[], status, resolvedAt, notes}` |
| Denied action records | `governance.denials.{requestId}` | project | Any approver denies, or deny_condition triggers | Denial dashboard, repeated-denial alerting | 365d | Critical | `{requestId, actionId, deniedBy, reason, denyCondition, timestamp}` |
| Audit trail entries | `governance.audit.{recordId}` | global | Every action (allowed, denied, gated, expired) | Audit log viewer, compliance reporting, post-mortem | 365d | Critical | Full `AuditRecord` (actor, action, result, tier, approvers, evidence, riskLevel, durationMs) |
| Release history | `governance.releases.{version}` | global | Release pipeline stage 6 completes | Release dashboard, rollback target selection | permanent | Critical | `{version, pipelineId, commitSha, branch, releasedAt, releasedBy, checklist, gateResults}` |
| Rollback events | `governance.rollbacks.{rollbackId}` | global | Rollback initiated (emergency or approved) | Incident timeline, rollback success rate tracking | 365d | Critical | `{rollbackId, trigger, emergency, currentVersion, targetVersion, status, verificationChecks}` |
| Pipeline run records | `governance.pipelines.{pipelineId}` | project | Pipeline completes (passed or failed) | CI/CD history, release readiness check | 90d | High | `{pipelineId, version, commitSha, stages[], status, totalDuration, artifacts[], gateResults[]}` |
| Dangerous action cooldowns | `governance.cooldowns.{actionId}` | global | Dangerous action executes | Cooldown enforcement before next execution | 1d | High | `{actionId, lastExecutedAt, cooldownMinutes, nextAllowedAt}` |
| Evidence bundle references | `governance.evidence.{requestId}` | project | Evidence attached to approval request | Approval review, adversarial audit | 365d | Medium | `{evidencePaths[], types[], attachedAt, attachedBy}` |
| Checklist completion state | `governance.checklists.{version}` | project | Checklist item status changes | Release gate evaluation, progress tracking | 90d | High | `{checklistId, version, items[], allPassed, signedOffBy, completedAt}` |

### 7. Speech / TTS (Existing)

| What to Remember | Key Pattern | Scope | Write Trigger | Recall Trigger | TTL | Priority | Value Type | Current Storage |
|-----------------|-------------|-------|---------------|----------------|-----|----------|------------|-----------------|
| Voice preferences | `speech.preferences` | global | User changes voice in SpeechTab UI | App startup, provider switch | permanent | Medium | `{providerId, voiceId, rate, pitch, volume, emphasis}` | VS Code settings `kilo-code.new.speech.*` |
| Favorite voices | `speech.favorites` | global | User stars a voice in voice browser | Voice browser sort order, quick-pick | permanent | Low | `{providerId, voiceId, name, favoritedAt}[]` | VS Code settings |
| Custom pronunciations | `speech.pronunciations` | project | User adds pronunciation rule | Text filter pipeline, SSML generation | permanent | Low | `{word, phoneme, addedAt}[]` | VS Code settings |
| Preset configurations | `speech.presets` | global | User saves a named preset | Preset picker dropdown | permanent | Low | `{presetName, providerId, voiceId, rate, pitch, volume, interactionMode, sentimentEnabled}` | VS Code settings |
| Synthesis cache stats | `speech.cache_stats` | session | LRU cache hit/miss | Cache tuning, debugging | session | Low | `{hits, misses, evictions, cacheSize}` | In-memory only |
| Provider connection results | `speech.provider_status.{providerId}` | global | `testConnection()` called from SpeechTab | Provider status indicator, startup health check | 7d | Medium | `{providerId, connected, testedAt, latencyMs, error}` | Not persisted |

> **Note:** Speech data currently lives in VS Code settings and in-memory caches, not in Shiba. See Migration Path section for the plan.

---

## Cross-Agent Memory Sharing

Memory sharing occurs through Shiba's cross-agent recall. The reader agent queries entries written by the source agent using `agent_id` filter in `RecallRequest`. All cross-agent reads are audited per the permission matrix in the memory spec.

| Source Agent | Key Pattern | Data | Consumer Agent | Use Case | Frequency |
|-------------|-------------|------|----------------|----------|-----------|
| `ssh-agent` | `ssh.health.{profileId}` | Host health snapshots | `training-agent` | GPU availability check on remote hosts before dispatching training jobs | On job submit |
| `ssh-agent` | `ssh.connections.{profileId}` | Connection history | `vps-agent` | Determine if host is reachable before VPS operations | On VPS command |
| `ssh-agent` | `ssh.auth_failures.{host}` | Failed auth records | `governance-agent` | Security audit, repeated failure alerting | On audit query |
| `vps-agent` | `vps.inventory.{vpsId}` | Instance specs (CPU/RAM) | `training-agent` | GPU/compute capacity assessment for remote training | On GPU target selection |
| `vps-agent` | `vps.incidents.{vpsId}` | Incident timeline | `governance-agent` | Incident-driven release hold decisions | On release gate check |
| `vps-agent` | `vps.costs.{vpsId}` | Instance cost data | `router-agent` | Total infrastructure cost reporting | On cost dashboard load |
| `zeroclaw` | `zeroclaw.violations` | Policy violation log | `governance-agent` | Risk model refinement, deny_condition tuning | On adversarial audit |
| `zeroclaw` | `zeroclaw.tasks.{taskId}` | Task outcomes | `governance-agent` | Release readiness assessment (failure rate) | On release checklist |
| `zeroclaw` | `zeroclaw.risk.{projectId}` | Risk classification history | `governance-agent` | Risk trend analysis, tier threshold adjustment | On governance review |
| `zeroclaw` | `zeroclaw.resources.{taskId}` | Resource usage data | `training-agent` | Workload-based GPU sizing | On resource planning |
| `router-agent` | `routing.costs.{providerId}` | Provider cost data | `governance-agent` | Budget enforcement, daily cap check, cost reporting | On budget check, daily |
| `router-agent` | `routing.errors.{providerId}` | Provider error rates | `governance-agent` | Provider reliability in release verdict | On release audit |
| `router-agent` | `routing.health.{providerId}` | Provider health history | `training-agent` | Remote GPU provider availability | On training job submit |
| `training-agent` | `training.jobs.{jobId}` | Model performance metrics | `governance-agent` | Release readiness (model quality gate) | On release checklist |
| `training-agent` | `training.exports.{exportId}` | Export records | `governance-agent` | Artifact integrity for deployment | On release pipeline |
| `training-agent` | `training.gpu.local` | Local GPU status | `vps-agent` | Decide whether to provision remote GPU instance | On VPS provision decision |
| `governance-agent` | `governance.cooldowns.{actionId}` | Action cooldown state | `zeroclaw` | Block task submission during cooldown | On task intake |
| `governance-agent` | `governance.approvals.{requestId}` | Approval status | `zeroclaw` | Check if task has required approvals before execution | On task execution |
| `speech-agent` | `speech.preferences` | Voice selection | `kilocode-core` | Auto-speak configuration for response rendering | On AI response complete |

---

## Memory Capacity Planning

### Per-Entry Size Estimates

| Data Type | Key Pattern | Avg Size/Entry | Max Size/Entry | Basis |
|-----------|-------------|----------------|----------------|-------|
| SSH connection record | `ssh.connections.*` | 350 bytes | 512 bytes | 7 fields, short strings, ISO timestamps |
| SSH command history | `ssh.commands.*` | 2 KB | 5 KB | 50 command strings, avg 40 chars each |
| Auth failure record | `ssh.auth_failures.*` | 250 bytes | 400 bytes | 6 fields, short strings |
| Remote file edit record | `ssh.edits.*` | 4 KB | 10 KB | Array of 100 edit entries, ~100 bytes each |
| Host health snapshot | `ssh.health.*` | 800 bytes | 1.2 KB | Nested CPU/RAM/disk/network metrics |
| VPS service restart | `vps.restarts.*` | 300 bytes | 500 bytes | 7 fields per restart event |
| VPS deploy outcome | `vps.deploys.*` | 600 bytes | 1 KB | Includes artifact checksums |
| VPS incident record | `vps.incidents.*` | 1 KB | 3 KB | Action array can grow |
| VPS performance baseline | `vps.baselines.*` | 200 bytes | 300 bytes | 6 numeric percentile fields |
| Task execution outcome | `zeroclaw.tasks.*` | 500 bytes | 1 KB | 10 fields including duration, status |
| Risk assessment record | `zeroclaw.risk.*` | 300 bytes | 500 bytes | 6 enum/string fields |
| Rollback record | `zeroclaw.rollbacks.*` | 600 bytes | 1.5 KB | File list can vary |
| Policy violation entry | `zeroclaw.violations` | 350 bytes | 500 bytes | 5 fields, short strings |
| Route decision trace | `routing.decisions.*` | 400 bytes | 700 bytes | 7 fields including reasoning string |
| Fallback event | `routing.fallbacks` | 250 bytes | 400 bytes | 6 fields |
| Provider latency sample | `routing.latency.*` | 150 bytes | 200 bytes | 5 numeric/string fields |
| Provider cost record | `routing.costs.*` | 200 bytes | 300 bytes | Daily aggregate, 5 fields |
| Provider error record | `routing.errors.*` | 200 bytes | 300 bytes | 5 fields |
| Dataset metadata | `training.datasets.*` | 2 KB | 8 KB | Column defs, splits, variable columns |
| Training job record | `training.jobs.*` | 1.5 KB | 3 KB | Full hyperparams + metrics |
| Training metrics event | `training.metrics.*` | 200 bytes | 300 bytes | 10 numeric fields per step |
| Checkpoint record | `training.checkpoints.*` | 500 bytes | 1 KB | Path, metrics, checksum |
| Export record | `training.exports.*` | 400 bytes | 800 bytes | Metadata, paths, format |
| Approval decision | `governance.approvals.*` | 800 bytes | 2 KB | Approver array, notes, evidence |
| Audit record | `governance.audit.*` | 1 KB | 3 KB | Full record with approvers, evidence paths |
| Release record | `governance.releases.*` | 2 KB | 5 KB | Checklist, gate results, artifacts |
| Pipeline run record | `governance.pipelines.*` | 1.5 KB | 4 KB | Stage array, artifacts, logs |
| Speech preference | `speech.preferences` | 200 bytes | 300 bytes | 6 simple fields |

### Monthly Growth Estimates

| Subsystem | Primary Data Types | Entries/Month (typical) | Monthly Growth | Annual Growth |
|-----------|-------------------|------------------------|----------------|---------------|
| SSH / Remote | Connections, commands, edits, health | 2,000 | 1.5 MB | 18 MB |
| VPS / Infrastructure | Restarts, deploys, incidents, inventory, costs | 800 | 600 KB | 7.2 MB |
| ZeroClaw Execution | Tasks, risk, rollbacks, violations, artifacts | 1,500 | 1.2 MB | 14.4 MB |
| Provider Routing | Decisions, fallbacks, latency, costs, errors | 10,000 | 2.5 MB | 30 MB |
| Training / GPU | Datasets, jobs, metrics, checkpoints, exports | 500 (jobs); 50,000 (metrics) | 12 MB | 144 MB |
| Governance / Release | Approvals, audit, releases, pipelines | 300 | 500 KB | 6 MB |
| Speech | Preferences, favorites, pronunciations | 20 | 5 KB | 60 KB |
| **Total** | | **~65,000** | **~18.3 MB** | **~220 MB** |

### Capacity Limits Check

| Limit (from memory spec) | Value | Projected Usage (1 year) | Status |
|--------------------------|-------|--------------------------|--------|
| `max_entry_size_bytes` | 64 KB | Largest entry: ~10 KB (file edit history) | Safe |
| `max_entries_per_project` | 10,000 | ~5,000 active entries (after TTL eviction) | Safe |
| `max_entries_global` | 5,000 | ~2,000 active global entries | Safe |
| `max_total_storage_bytes` | 100 MB | ~18 MB/month before TTL eviction | Safe (TTL keeps it under 40 MB steady-state) |

> **Warning:** Training metrics (`training.metrics.*`) generate the highest volume at ~50,000 entries/month during active training. These should use short TTLs (90d) and be compacted into job-level summaries after training completes. If multiple concurrent training jobs run, consider batching metrics into array entries per job rather than individual step entries.

---

## Memory Failure Impact

| Failure Mode | Affected Subsystems | Impact | Severity | Mitigation |
|-------------|---------------------|--------|----------|------------|
| Shiba connection lost (`MEM_CONNECTION_LOST`) | All | No cross-session recall; new session starts with no historical context | High | Local cache (50 MB, `failure_handling.connection_lost.local_cache_path`), queue writes for replay on reconnect, degrade gracefully |
| Memory entry corruption (`MEM_ENTRY_CORRUPTED`) | All | Stale or wrong data returned for a specific key | Medium | SHA-256 checksum validation on read, exclude corrupted from recall, rollback to previous version if available |
| Quota exceeded (`MEM_QUOTA_EXCEEDED`) | Primarily Training, Routing (highest volume) | New writes rejected, latest state not persisted | Medium | TTL-based eviction (auto-expire by `expires_at`), compact training metrics, prune old route traces |
| Recall timeout (`MEM_RECALL_TIMEOUT`) | All | Subsystem operates without historical context for one request | Low | Fall back to local recall cache (TTL 300s), return empty with warning, retry on next access |
| Auth token expired (`MEM_AUTH_EXPIRED`) | All | All reads and writes fail until token refreshed | High | Auto-refresh token 300s before expiry (config: `token_refresh_before_expiry_seconds`), alert user if refresh fails |
| Write queue overflow | All (during extended disconnection) | Oldest queued writes dropped, data loss for that period | Medium | Cap queue at 50 MB (`max_local_cache_mb`), prioritize high-priority writes (governance audit > routing latency samples), dead-letter failed writes to `data/memory/dead_letter.jsonl` |
| Cross-agent read denied (`MEM_SCOPE_DENIED`) | Training (reading SSH health), Governance (reading ZeroClaw violations) | Consumer agent cannot access data it needs for decision | Medium | Pre-validate permission matrix at startup, log denied reads for config correction, fall back to direct service call |
| Network partition (intermittent) | All | Writes succeed sometimes, fail others; inconsistent state | High | Idempotent writes with `conflict_resolution: last_write_wins`, version numbers detect stale reads, queue provides ordering guarantee |

### Priority-Based Write Triage (during degraded connection)

When the local write queue is under pressure, entries are prioritized:

| Priority | Data Types | Rationale |
|----------|-----------|-----------|
| Critical | Governance audit trail, policy violations, rollback records, release history | Legal/compliance obligation, tamper-detection chain, cannot be reconstructed |
| High | Auth failures, approval decisions, cost accumulation, circuit breaker state | Security and budget enforcement depend on accurate state |
| Medium | Task outcomes, connection history, health snapshots, dataset metadata | Important for continuity but can be approximated from other sources |
| Low | Command history, latency samples, cache stats, favorites | Convenience data; loss causes minor UX degradation, not functional failure |

---

## Privacy and Security

### Sensitive Data Classification

| Key Pattern | Sensitivity | Contains PII | Contains Secrets | Encryption Required |
|-------------|-------------|-------------|-----------------|---------------------|
| `ssh.auth_failures.*` | High | Username, host | No (never stores passwords/keys) | At rest |
| `ssh.fingerprints.*` | Medium | No | Host key fingerprints (public) | No |
| `ssh.commands.*` | Medium | Possible (commands may contain usernames, paths) | Possible (commands may contain tokens) | At rest, scan before write |
| `vps.inventory.*` | Medium | No | IP addresses | At rest |
| `zeroclaw.violations` | High | User ID (requestedBy) | No | At rest |
| `governance.audit.*` | High | Actor IDs, IP addresses | No | At rest |
| `governance.approvals.*` | High | Approver IDs, comments | No | At rest |
| `routing.costs.*` | Medium | No | No | No |
| `training.datasets.*` | Low-High | Depends on dataset content | No | Depends on dataset classification |
| `speech.preferences` | Low | No | No | No |

### Data Handling Rules

1. **Secret scanning**: Before writing any memory entry, scan the value for patterns matching API keys, tokens, passwords, and connection strings using the ZeroClaw secret masking regex: `(?i)(api[_-]?key|secret|token|password|credential|connection[_-]?string)\s*[=:]\s*\S+`. Redact matches with `[REDACTED]`.

2. **Encryption at rest**: All entries marked "At rest" in the table above must be encrypted before storage in Shiba. Encryption key is derived from the `SHIBA_AUTH_TOKEN` using HKDF-SHA256.

3. **Data retention compliance (GDPR)**: 
   - All entries containing PII (actor IDs, usernames, IP addresses) must be deletable via a "right to delete" operation.
   - `ShibaService` must implement `deleteByActorId(actorId: string)` that purges all entries where the actor ID appears in the value.
   - Retention periods in the TTL column are maximums; the system must support early deletion.

4. **Audit of access**: Every cross-agent recall is logged in `data/memory/audit/YYYY-MM-DD.jsonl` with the reading agent ID, query, scope, and entry IDs accessed. Retention: 180 days.

5. **Project isolation**: Memory entries with `scope: "project"` are namespaced by `project:{project_path_hash}`. No agent can read another project's entries unless it holds the `cross_project_read` permission (only `kilocode-core` has this).

---

## Migration Path

### Current State

| Data Type | Current Storage | Location | Limitations |
|-----------|----------------|----------|-------------|
| Voice preferences | VS Code settings | `kilo-code.new.speech.*` (31 keys) | Not available cross-machine, not queryable, no versioning |
| Voice favorites | VS Code settings | `kilo-code.new.speech.favorites` | Same |
| Custom pronunciations | VS Code settings | `kilo-code.new.speech.pronunciations` | Same |
| SSH profiles | YAML file | `config/ssh/profiles.yaml` | No history, no access tracking |
| Provider config | YAML file | `config/providers.yaml` | No runtime health history |
| LRU synthesis cache | In-memory | `speech-playback.ts` (32 entries) | Lost on reload, no cross-session |
| Route traces | JSONL file | `data/traces/routes/YYYY-MM-DD.jsonl` | Not queryable by Shiba, no cross-agent recall |
| Governance audit | JSONL file | `data/governance/audit/YYYY-MM-DD.jsonl` | Not queryable by Shiba, local only |

### Target State

| Data Type | Target Storage | Location | Benefits |
|-----------|---------------|----------|----------|
| Voice preferences | Shiba (global scope) | `speech.preferences` | Cross-machine sync, versioned, queryable |
| Voice favorites | Shiba (global scope) | `speech.favorites` | Same |
| Custom pronunciations | Shiba (project scope) | `speech.pronunciations` | Project-specific, cross-session |
| SSH connection history | Shiba (project scope) | `ssh.connections.*` | Cross-session recall, health correlation |
| Provider health history | Shiba (global scope) | `routing.health.*` | Cross-agent access by training and governance |
| Route traces | Shiba (project scope) | `routing.decisions.*` | Queryable, cross-agent recall, TTL management |
| Governance audit | Shiba (global scope) | `governance.audit.*` | Cross-agent recall, compliance queries |
| All new subsystem data | Shiba | Per key patterns above | Full Shiba capabilities from day one |

### Migration Strategy

**Phase 1: Dual-read (non-breaking)**
- New code reads from Shiba first, falls back to VS Code settings / JSONL if Shiba returns empty.
- All new writes go to Shiba.
- VS Code settings remain the source of truth for speech preferences until migration completes.

**Phase 2: Backfill**
- On first activation after upgrade, a one-time migration job reads existing VS Code settings and JSONL files and writes them to Shiba.
- Migration writes use `conflict_resolution: reject_if_exists` to avoid overwriting data that was already written to Shiba by Phase 1.
- Migration progress is tracked in `__global__:_system.migration.status`.

**Phase 3: Shiba-primary**
- Shiba becomes the source of truth.
- VS Code settings writes are stopped for migrated keys.
- VS Code settings are kept read-only as a fallback for offline scenarios (Shiba disconnected).

**Phase 4: Deprecate local**
- VS Code settings for migrated keys are marked deprecated in `package.json` contribution points.
- Local JSONL files for route traces and audit are no longer written.
- Old files are retained for 90 days, then eligible for cleanup.

### Migration Key Mapping

| VS Code Setting Key | Shiba Key | Scope | Notes |
|--------------------|-----------| ------|-------|
| `kilo-code.new.speech.provider` | `speech.preferences` (`.providerId`) | global | Part of preference object |
| `kilo-code.new.speech.voice` | `speech.preferences` (`.voiceId`) | global | Part of preference object |
| `kilo-code.new.speech.rate` | `speech.preferences` (`.rate`) | global | Part of preference object |
| `kilo-code.new.speech.pitch` | `speech.preferences` (`.pitch`) | global | Part of preference object |
| `kilo-code.new.speech.volume` | `speech.preferences` (`.volume`) | global | Part of preference object |
| `kilo-code.new.speech.enabled` | `speech.preferences` (`.enabled`) | global | Part of preference object |
| `kilo-code.new.speech.azure.apiKey` | NOT MIGRATED | -- | Stays in VS Code SecretStorage; never stored in Shiba |
| `kilo-code.new.speech.google.apiKey` | NOT MIGRATED | -- | Same |
| `kilo-code.new.speech.openai.apiKey` | NOT MIGRATED | -- | Same |
| `kilo-code.new.speech.elevenlabs.apiKey` | NOT MIGRATED | -- | Same |
| `kilo-code.new.speech.polly.accessKeyId` | NOT MIGRATED | -- | Same |

> **API keys are never migrated to Shiba.** They remain in VS Code SecretStorage (extension host) or VS Code settings (webview-accessible TTS keys). Shiba entries must never contain plaintext credentials.

---

## Key Design Decisions

1. **Training metrics batching**: To avoid exceeding `max_entries_per_project` (10,000), training step metrics are batched into arrays of 100 steps per entry. A training job with 5,000 steps produces 50 metric entries, not 5,000.

2. **Route trace TTL**: Route traces use 90d TTL rather than permanent storage because the volume (10,000+/month) would exhaust quotas. Historical traces older than 90 days are summarized into daily aggregates before expiry.

3. **Governance audit permanence**: Governance audit records use 365d TTL (the maximum practical retention). For compliance, the JSONL file backup (`data/governance/audit/`) is retained independently as a tamper-evident archive even after Shiba entries expire.

4. **Speech migration opt-in**: Speech preferences migration from VS Code settings to Shiba is non-breaking. Users who never connect to Shiba continue using VS Code settings without disruption.

5. **Write priority during degradation**: When the local write queue is full, the system drops low-priority entries (command history, cache stats) before high-priority entries (audit trail, policy violations). This ensures compliance-critical data is never silently lost.
