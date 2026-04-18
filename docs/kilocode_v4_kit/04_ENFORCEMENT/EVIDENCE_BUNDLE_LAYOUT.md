# Evidence Bundle Layout
Date: 2026-04-17

## Purpose

Every phase must produce evidence proving its implementation works. This document defines
where evidence is stored, what formats are accepted, naming conventions, and the specific
evidence required for each of the 72 phases. No phase may close without a complete evidence
bundle. The Evidence Steward enforces this requirement.

---

## Directory Structure

```
evidence/
├── block-a/
│   ├── phase-01/          # Source of truth files
│   ├── phase-02/          # Feature truth matrix
│   ├── phase-03/          # Defect ledger
│   ├── phase-04/          # Run ledger
│   ├── phase-05/          # Capability inventory
│   ├── phase-06/          # Architecture boundaries
│   ├── phase-07/          # Config paths and env vars
│   ├── phase-08/          # Evidence bundle layout
│   ├── phase-09/          # Completion gates and hard-stop rules
│   └── phase-10/          # Baseline drift scan
├── block-b/
│   ├── phase-11/          # Top 12 operator workflows
│   ├── phase-12/          # Risk-score workflows
│   ├── phase-13/          # Approval requirements
│   ├── phase-14/          # Provider requirements
│   ├── phase-15/          # Memory requirements
│   └── phase-16/          # Execution substrate requirements
├── block-c/
│   ├── phase-17/          # SSH profile schema
│   ├── phase-18/          # SSH host groups and labels
│   ├── phase-19/          # Key management and validation flow
│   ├── phase-20/          # Jump-host support
│   ├── phase-21/          # Terminal tabs and reconnect
│   ├── phase-22/          # SFTP browser
│   ├── phase-23/          # Remote edit/save flow
│   ├── phase-24/          # Diff-before-save flow
│   ├── phase-25/          # Remote logs/transcript capture
│   └── phase-26/          # Permission-denied and host-down failure paths
├── block-d/
│   ├── phase-27/          # VPS inventory model
│   ├── phase-28/          # CPU/RAM/disk panels
│   ├── phase-29/          # Service/process panels
│   ├── phase-30/          # Docker/Compose panels
│   ├── phase-31/          # Reverse proxy and app-service controls
│   ├── phase-32/          # Backup/restore runbooks
│   ├── phase-33/          # Deploy and rollback quick-actions
│   └── phase-34/          # Incident and recovery flow
├── block-e/
│   ├── phase-35/          # Task intake schema
│   ├── phase-36/          # Execution risk levels
│   ├── phase-37/          # Hermes->ZeroClaw adapter contract
│   ├── phase-38/          # Workspace scope rules
│   ├── phase-39/          # Network policy rules
│   ├── phase-40/          # Low-risk auto path
│   ├── phase-41/          # Medium-risk buffered diff path
│   ├── phase-42/          # High-risk approval gate
│   ├── phase-43/          # Artifact/log/result return surfaces
│   └── phase-44/          # Rollback/retry behavior
├── block-f/
│   ├── phase-45/          # Provider role matrix
│   ├── phase-46/          # Claude lane
│   ├── phase-47/          # MiniMax lane
│   ├── phase-48/          # SiliconFlow lane
│   ├── phase-49/          # Ollama / LM Studio local lane
│   ├── phase-50/          # Health and env validation
│   ├── phase-51/          # Wrong-role block/reroute
│   └── phase-52/          # Cost/trace/fallback display
├── block-g/
│   ├── phase-53/          # Shiba connectivity status
│   ├── phase-54/          # Recall trace panel
│   ├── phase-55/          # Memory write history
│   ├── phase-56/          # Project-scoped memory model
│   ├── phase-57/          # Cross-agent recall workflow
│   └── phase-58/          # Memory failure-path handling
├── block-h/
│   ├── phase-59/          # Dataset registry
│   ├── phase-60/          # Dataset validation/preprocessing
│   ├── phase-61/          # Training job templates
│   ├── phase-62/          # Local vs remote GPU target selection
│   ├── phase-63/          # Job monitoring panels
│   ├── phase-64/          # Checkpoint resume/stop
│   ├── phase-65/          # Compare-runs workflow
│   └── phase-66/          # Export/package workflow
├── block-i/
│   ├── phase-67/          # Authority tiers
│   ├── phase-68/          # Approval modal + audit history
│   ├── phase-69/          # Dangerous action deny/gate rules
│   ├── phase-70/          # CI/CD, build, package, release, rollback panels
│   ├── phase-71/          # Adversarial final audit
│   └── phase-72/          # Release verdict + packaging
└── release/
    └── v4.0.0/            # Final release evidence
        ├── acceptance-reports/
        ├── screenshots/
        ├── test-logs/
        ├── truth-matrix-snapshot.md
        └── defect-ledger-snapshot.md
```

Each phase directory will contain an `ACCEPTANCE_REPORT.md` (copied from the template in
`04_ENFORCEMENT/ACCEPTANCE_REPORT_TEMPLATE.md`) plus all supporting evidence files.

---

## Evidence Types

| Type | Format | Naming Convention | Example |
|------|--------|-------------------|---------|
| Screenshot | PNG | `screenshot-<feature>-<date>.png` | `screenshot-ssh-connect-2026-04-17.png` |
| Test log | TXT/LOG | `test-run-<suite>-<date>.log` | `test-run-ssh-unit-2026-04-17.log` |
| Config sample | YAML/JSON | `config-sample-<name>.yaml` | `config-sample-ssh-profile.yaml` |
| Transcript | MD | `transcript-<workflow>-<date>.md` | `transcript-ssh-connect-flow-2026-04-17.md` |
| Diff | PATCH | `diff-<feature>-<date>.patch` | `diff-sftp-browser-2026-04-17.patch` |
| Build output | LOG | `build-<target>-<date>.log` | `build-esbuild-2026-04-17.log` |
| Validation report | JSON | `validation-<script>-<date>.json` | `validation-parity-check-2026-04-17.json` |
| Coverage report | TXT/HTML | `coverage-<scope>-<date>.txt` | `coverage-ssh-service-2026-04-17.txt` |
| Security scan | JSON/TXT | `security-scan-<scope>-<date>.json` | `security-scan-auth-2026-04-17.json` |
| Complexity report | TXT | `complexity-<scope>-<date>.txt` | `complexity-ssh-service-2026-04-17.txt` |
| Acceptance report | MD | `ACCEPTANCE_REPORT.md` | `ACCEPTANCE_REPORT.md` |

---

## Required Evidence Per Phase Type

### Documentation Phase (Block A)

- File exists and has content (file listing)
- Validation script passes (validation report JSON)
- Content is accurate and matches runtime reality

### Workflow/Requirements Phase (Block B)

- Document created with all required sections
- Validation script passes
- Cross-references to dependent phases verified

### Schema/Model Phase

- Schema file created and parseable
- TypeScript types generated (if applicable)
- Unit tests passing (test log)
- Config sample that validates against the schema

### UI Phase

- Screenshot of rendered component in its real environment
- Integration test log
- Failure-state screenshot (error banner, empty state, loading state)

### Integration Phase

- End-to-end transcript showing the full workflow
- Error handling screenshots (at least 3 distinct failure scenarios)
- Performance baseline (response time, resource usage)

### Infrastructure Phase (Blocks C, D)

- Connection/operation log proving the feature works against a real target
- Config sample with valid credentials redacted
- Failure-path test log (timeout, auth denied, host unreachable)

### Security/Policy Phase

- Policy enforcement log (blocked action + reason)
- Bypass attempt log (attempted circumvention + denial proof)
- Security scan output

### Governance/Release Phase (Block I)

- Audit trail export
- Gate pass/fail log
- Release artifact manifest with integrity hashes

---

## Integrity Rules

1. Evidence must be committed to git (hash-verifiable via `git log --format=%H`).
2. Screenshots must show real running software, not mockups or design tools.
3. Test logs must show actual pass/fail counts -- unedited raw output.
4. Config samples must be valid and parseable by the schema they claim to satisfy.
5. Transcripts must be actual session records, not fabricated narratives.
6. Evidence must be generated from the same git commit referenced in the Acceptance Report.
7. The Evidence Steward may reject any evidence that appears fabricated or selectively edited.
8. Evidence files must not contain secrets (API keys, passwords, tokens). Redact before commit.
9. Each evidence file must be named according to the conventions in the Evidence Types table.
10. Evidence directories must not contain files unrelated to the phase they belong to.

---

## Phase-Evidence Mapping

The table below lists every phase and its specific required evidence. The "Minimum Bundle"
column lists the files that must exist in the phase directory for the phase to pass. The
"Acceptance Report" is always required and is not listed separately.

### Block A -- Truth, Inventory, and Operating Model (Phases 01-10)

| Phase | Title | Minimum Bundle |
|-------|-------|----------------|
| 01 | Establish source-of-truth files | `validation-parity-check.json` -- parity check output showing all truth files exist. `file-listing.txt` -- listing of every truth file with path and byte count. |
| 02 | Create feature truth matrix | `validation-truth-matrix.json` -- truth validator output. `truth-matrix-row-count.txt` -- count of rows per subsystem confirming completeness. |
| 03 | Create defect ledger | `validation-defect-ledger.json` -- schema validation of ledger format. `defect-ledger-sample.md` -- the ledger file with at least the header row and format example. |
| 04 | Create run ledger | `validation-run-ledger.json` -- schema validation of JSONL format. `run-ledger-sample.jsonl` -- sample entries demonstrating correct format. |
| 05 | Capture current-state capability inventory | `capability-inventory.json` -- structured inventory of all current features. `validation-inventory.json` -- validator output confirming completeness. |
| 06 | Define architecture boundaries | `architecture-boundary-map.json` -- machine-readable boundary definitions. `validation-boundaries.json` -- validator output. `diagram-architecture-boundaries.png` -- visual diagram of layers and allowed interactions. |
| 07 | Index config paths and env vars | `config-path-index.json` -- every config file path with schema reference. `env-var-index.json` -- every required environment variable with description. `validation-config-paths.json` -- validator confirming all paths exist on disk. |
| 08 | Define evidence bundle layout | `validation-evidence-dirs.json` -- script output confirming all evidence directories exist. `file-listing.txt` -- listing of evidence directory structure. |
| 09 | Define completion gates and hard-stop rules | `validation-gates.json` -- validator confirming gate definitions are complete. `gate-definitions.json` -- machine-readable gate criteria per phase type. |
| 10 | Baseline drift scan | `drift-scan-baseline.json` -- full drift scan output capturing current state. `validation-drift.json` -- validator confirming no unexpected drift from truth matrix. `drift-delta-summary.txt` -- human-readable summary of any discrepancies found. |

### Block B -- User-Facing Operating Flows (Phases 11-16)

| Phase | Title | Minimum Bundle |
|-------|-------|----------------|
| 11 | Define top 12 operator workflows | `workflow-catalog.json` -- structured list of all 12 workflows with steps, actors, and triggers. `validation-workflows.json` -- validator confirming each workflow references valid phases. |
| 12 | Risk-score workflows | `risk-scoring-model.json` -- scoring criteria, weights, and thresholds. `validation-risk-scores.json` -- validator confirming all 12 workflows have risk scores. `risk-score-examples.json` -- at least 3 example tasks with computed risk scores. |
| 13 | Map approval requirements | `approval-matrix.json` -- who can approve what, per risk tier and subsystem. `validation-approvals.json` -- validator confirming every high-risk workflow has an approver. |
| 14 | Map provider requirements | `provider-requirements.json` -- per-workflow provider assignments and fallback chains. `validation-providers.json` -- validator confirming every workflow has a primary and fallback provider. |
| 15 | Map memory requirements | `memory-requirements.json` -- per-workflow memory read/write needs. `validation-memory.json` -- validator confirming memory-dependent workflows reference valid scopes. |
| 16 | Map execution substrate requirements | `substrate-requirements.json` -- per-workflow execution environment needs (local, sandbox, remote GPU). `validation-substrate.json` -- validator confirming substrate assignments cover all workflows. |

### Block C -- SSH and Remote Systems (Phases 17-26)

| Phase | Title | Minimum Bundle |
|-------|-------|----------------|
| 17 | SSH profile schema | `config-sample-ssh-profile.yaml` -- valid sample profile exercising all fields. `test-run-ssh-schema-validation.log` -- unit test output for schema validation. `screenshot-ssh-profile-form.png` -- profile creation UI. |
| 18 | SSH host groups and labels | `config-sample-ssh-groups.yaml` -- sample group definitions. `test-run-ssh-groups.log` -- unit tests for group CRUD. `screenshot-ssh-group-list.png` -- group list UI with filter applied. |
| 19 | Key management and validation flow | `test-run-ssh-key-management.log` -- unit tests for key import, validation, rotation. `screenshot-ssh-key-list.png` -- key management panel. `transcript-key-import-flow.md` -- end-to-end key import transcript. |
| 20 | Jump-host support | `test-run-ssh-jump-host.log` -- unit tests for proxy chain resolution. `transcript-jump-connect.md` -- transcript showing multi-hop connection. `screenshot-ssh-jump-config.png` -- jump-host configuration UI. |
| 21 | Terminal tabs and reconnect | `test-run-ssh-terminal.log` -- unit tests for tab management and session cache. `screenshot-ssh-terminal-tabs.png` -- multiple terminal tabs. `screenshot-ssh-reconnect-banner.png` -- reconnect notification after disconnect. `transcript-reconnect-flow.md` -- disconnect and reconnect transcript. |
| 22 | SFTP browser | `test-run-sftp-browser.log` -- unit tests for tree provider and navigation. `screenshot-sftp-tree-view.png` -- remote file tree with expanded directories. `transcript-sftp-browse-flow.md` -- browsing session transcript. |
| 23 | Remote edit/save flow | `test-run-remote-edit.log` -- unit tests for VFS provider and save operations. `screenshot-remote-editor.png` -- remote file open in editor tab. `transcript-remote-edit-save.md` -- edit and save transcript. |
| 24 | Diff-before-save flow | `test-run-diff-save.log` -- unit tests for diff engine and confirmation gate. `screenshot-diff-modal.png` -- unified diff view before save. `transcript-diff-accept-reject.md` -- accept and reject transcript. |
| 25 | Remote logs/transcript capture | `test-run-remote-logs.log` -- unit tests for log streamer. `screenshot-remote-log-panel.png` -- streaming log panel. `transcript-log-export.md` -- log capture and export transcript. |
| 26 | Permission-denied and host-down failure paths | `test-run-ssh-failure-paths.log` -- unit tests for error classifier and notification. `screenshot-permission-denied.png` -- permission denied error banner. `screenshot-host-unreachable.png` -- host down error banner. `transcript-failure-recovery.md` -- failure and recovery transcript. |

### Block D -- VPS and Infra Operations (Phases 27-34)

| Phase | Title | Minimum Bundle |
|-------|-------|----------------|
| 27 | VPS inventory model | `config-sample-vps-inventory.yaml` -- sample inventory with multiple nodes. `test-run-vps-inventory.log` -- unit tests for inventory store and schema. `screenshot-vps-inventory-grid.png` -- inventory grid with status badges. |
| 28 | CPU/RAM/disk panels | `test-run-vps-metrics.log` -- unit tests for metrics poller and chart renderer. `screenshot-vps-resource-graphs.png` -- live resource utilization graphs. `transcript-metrics-polling.md` -- polling session transcript. |
| 29 | Service/process panels | `test-run-vps-services.log` -- unit tests for systemctl adapter and service listing. `screenshot-vps-service-list.png` -- service list with action buttons. `transcript-service-restart.md` -- service restart transcript with approval. |
| 30 | Docker/Compose panels | `test-run-vps-docker.log` -- unit tests for docker and compose adapter. `screenshot-vps-container-list.png` -- container list with status. `transcript-docker-restart.md` -- container restart transcript. |
| 31 | Reverse proxy and app-service controls | `test-run-vps-proxy.log` -- unit tests for proxy config parser. `screenshot-vps-proxy-rules.png` -- proxy rules viewer. `config-sample-proxy-config.yaml` -- sample proxy configuration. |
| 32 | Backup/restore runbooks | `test-run-vps-backup.log` -- unit tests for snapshot creation and restore. `transcript-backup-restore.md` -- full backup and restore transcript. `config-sample-backup-schedule.yaml` -- sample backup schedule. |
| 33 | Deploy and rollback quick-actions | `test-run-vps-deploy.log` -- unit tests for deploy pipeline and rollback handler. `transcript-deploy-flow.md` -- deploy + health check transcript. `transcript-rollback-flow.md` -- rollback + health check transcript. `screenshot-vps-deploy-panel.png` -- deploy panel with quick-action buttons. |
| 34 | Incident and recovery flow | `test-run-vps-incident.log` -- unit tests for incident classifier and recovery playbook. `screenshot-vps-recovery-wizard.png` -- recovery wizard UI. `transcript-incident-recovery.md` -- full incident detection and recovery transcript. |

### Block E -- ZeroClaw Integration (Phases 35-44)

| Phase | Title | Minimum Bundle |
|-------|-------|----------------|
| 35 | Task intake schema | `config-sample-task-intake.json` -- sample Hermes envelope with all required fields. `test-run-task-intake.log` -- unit tests for envelope builder and schema validation. `screenshot-task-intake-form.png` -- task intake form UI. |
| 36 | Execution risk levels | `test-run-risk-classification.log` -- unit tests for risk classifier with low/medium/high inputs. `risk-classification-examples.json` -- at least 5 example tasks with computed risk levels. `screenshot-risk-badge.png` -- risk badge display on task. |
| 37 | Hermes->ZeroClaw adapter contract | `test-run-adapter-contract.log` -- unit tests for adapter message format and handshake. `config-sample-adapter-contract.json` -- sample adapter request/response pair. `transcript-adapter-roundtrip.md` -- full envelope send and result return transcript. |
| 38 | Workspace scope rules | `test-run-workspace-scope.log` -- unit tests for scope guard and workspace policy. `transcript-scope-enforcement.md` -- transcript showing allowed and denied file access. `config-sample-workspace-scope.yaml` -- sample scope rules. |
| 39 | Network policy rules | `test-run-network-policy.log` -- unit tests for network policy enforcement. `transcript-network-enforcement.md` -- transcript showing allowed and blocked network calls. `config-sample-network-policy.yaml` -- sample network rules. |
| 40 | Low-risk auto path | `test-run-low-risk-auto.log` -- unit tests for auto-execution of read-only tasks. `transcript-low-risk-auto.md` -- end-to-end transcript showing execution without approval prompt. `screenshot-low-risk-execution.png` -- execution timeline for a low-risk task. |
| 41 | Medium-risk buffered diff path | `test-run-medium-risk-diff.log` -- unit tests for buffered write operations and diff generation. `screenshot-medium-risk-diff-panel.png` -- diff panel showing pending changes. `transcript-medium-risk-accept-reject.md` -- accept and reject transcript. |
| 42 | High-risk approval gate | `test-run-high-risk-gate.log` -- unit tests for approval gate and blocking behavior. `screenshot-high-risk-approval-modal.png` -- approval modal with actor and timestamp. `transcript-high-risk-approval.md` -- full approval flow transcript including deny path. |
| 43 | Artifact/log/result return surfaces | `test-run-artifact-return.log` -- unit tests for artifact renderer and log streamer. `screenshot-artifact-panel.png` -- artifact panel with returned outputs. `screenshot-log-stream-panel.png` -- live log streaming panel. `transcript-artifact-inspection.md` -- artifact inspection transcript. |
| 44 | Rollback/retry behavior | `test-run-rollback-retry.log` -- unit tests for rollback handler and retry logic. `transcript-rollback-flow.md` -- full rollback transcript with before/after state. `transcript-retry-flow.md` -- retry with modified parameters transcript. |

### Block F -- Provider Routing (Phases 45-52)

| Phase | Title | Minimum Bundle |
|-------|-------|----------------|
| 45 | Provider role matrix | `provider-role-matrix.json` -- machine-readable role-to-provider mapping. `validation-role-matrix.json` -- validator confirming every task type has a provider assignment. `test-run-role-matrix.log` -- unit tests for role resolution. |
| 46 | Claude lane | `test-run-claude-lane.log` -- unit tests for Claude provider adapter. `transcript-claude-routing.md` -- routing trace showing Claude selection for a contract task. `config-sample-claude-lane.yaml` -- Claude lane configuration. |
| 47 | MiniMax lane | `test-run-minimax-lane.log` -- unit tests for MiniMax provider adapter. `transcript-minimax-routing.md` -- routing trace showing MiniMax selection for an execution task. `config-sample-minimax-lane.yaml` -- MiniMax lane configuration. |
| 48 | SiliconFlow lane | `test-run-siliconflow-lane.log` -- unit tests for SiliconFlow provider adapter. `transcript-siliconflow-fallback.md` -- routing trace showing SiliconFlow as fallback. `config-sample-siliconflow-lane.yaml` -- SiliconFlow lane configuration. |
| 49 | Ollama / LM Studio local lane | `test-run-local-lane.log` -- unit tests for Ollama/LM Studio adapter. `transcript-local-routing.md` -- routing trace showing local routing with no external network call. `config-sample-local-lane.yaml` -- local lane configuration. |
| 50 | Health and env validation | `test-run-health-check.log` -- unit tests for health prober and env validator. `screenshot-health-indicators.png` -- provider health indicator panel. `screenshot-env-validation-errors.png` -- validation error display at startup. `transcript-health-probe.md` -- health probe transcript with response times. |
| 51 | Wrong-role block/reroute | `test-run-wrong-role-block.log` -- unit tests for role guard and reroute handler. `transcript-wrong-role-block.md` -- transcript showing block event and reroute trace. `screenshot-block-badge.png` -- block badge display on routing trace. |
| 52 | Cost/trace/fallback display | `test-run-cost-trace.log` -- unit tests for cost tracker and trace store. `screenshot-cost-breakdown.png` -- per-task cost breakdown panel. `screenshot-fallback-timeline.png` -- fallback event timeline. `transcript-cost-trace-export.md` -- cost ledger export transcript. |

### Block G -- Memory and Continuity (Phases 53-58)

| Phase | Title | Minimum Bundle |
|-------|-------|----------------|
| 53 | Shiba connectivity status | `test-run-shiba-connect.log` -- unit tests for Shiba client and heartbeat. `screenshot-shiba-connection-status.png` -- connection indicator in settings. `transcript-shiba-handshake.md` -- connection handshake transcript. |
| 54 | Recall trace panel | `test-run-recall-trace.log` -- unit tests for recall query and trace rendering. `screenshot-recall-trace.png` -- recall trace panel showing fact provenance. `transcript-recall-query.md` -- recall query and response transcript. |
| 55 | Memory write history | `test-run-memory-write.log` -- unit tests for write log and history panel. `screenshot-memory-write-history.png` -- write history timeline. `transcript-memory-write.md` -- fact write and confirmation transcript. |
| 56 | Project-scoped memory model | `test-run-project-scope.log` -- unit tests for scope resolver and scoped queries. `transcript-scoped-vs-unscoped.md` -- transcript showing scoped query result differs from unscoped. `config-sample-memory-scope.yaml` -- project scope configuration. |
| 57 | Cross-agent recall workflow | `test-run-cross-agent-recall.log` -- unit tests for cross-scope query. `transcript-cross-agent-recall.md` -- transcript showing Agent-A writes a fact and Agent-B recalls it. `screenshot-cross-agent-badge.png` -- cross-agent recall badge on task detail. |
| 58 | Memory failure-path handling | `test-run-memory-failure.log` -- unit tests for error handler and degraded-mode behavior. `screenshot-memory-error-banner.png` -- error banner when memory backend is down. `transcript-memory-degraded-mode.md` -- transcript showing graceful degradation during backend outage. |

### Block H -- Training and GPU Orchestration (Phases 59-66)

| Phase | Title | Minimum Bundle |
|-------|-------|----------------|
| 59 | Dataset registry | `test-run-dataset-registry.log` -- unit tests for dataset store and registration. `screenshot-dataset-list.png` -- dataset list panel. `config-sample-dataset-registry.yaml` -- sample dataset registration entry. |
| 60 | Dataset validation/preprocessing | `test-run-dataset-validation.log` -- unit tests for schema validation and format checks. `screenshot-validation-report.png` -- validation report panel. `validation-dataset-sample.json` -- validator output for a sample dataset. |
| 61 | Training job templates | `test-run-job-templates.log` -- unit tests for template resolver and preset loading. `screenshot-template-picker.png` -- template picker UI (LoRA, QLoRA, custom). `config-sample-training-template.yaml` -- sample training template with all parameters. |
| 62 | Local vs remote GPU target selection | `test-run-gpu-selection.log` -- unit tests for GPU allocator and target resolution. `screenshot-target-selector.png` -- GPU target selector UI. `transcript-gpu-allocation.md` -- allocation transcript showing local and remote selection. |
| 63 | Job monitoring panels | `test-run-job-monitor.log` -- unit tests for metrics streamer and chart renderer. `screenshot-training-dashboard.png` -- live training dashboard with loss and LR curves. `transcript-job-monitoring.md` -- monitoring session transcript. |
| 64 | Checkpoint resume/stop | `test-run-checkpoint-resume.log` -- unit tests for checkpoint loader and resume logic. `transcript-checkpoint-resume.md` -- transcript showing stop, checkpoint save, and resume. `screenshot-checkpoint-list.png` -- checkpoint list with resume button. |
| 65 | Compare-runs workflow | `test-run-compare-runs.log` -- unit tests for comparison engine and run store. `screenshot-compare-runs.png` -- side-by-side comparison charts. `transcript-compare-runs.md` -- run comparison transcript with metric diffs. |
| 66 | Export/package workflow | `test-run-export-package.log` -- unit tests for packager and artifact store. `transcript-export-flow.md` -- full export transcript with integrity hash verification. `build-model-package.log` -- build output for the exported package. |

### Block I -- Governance, Release, Finalization (Phases 67-72)

| Phase | Title | Minimum Bundle |
|-------|-------|----------------|
| 67 | Authority tiers | `test-run-authority-tiers.log` -- unit tests for tier resolver and permission checks. `config-sample-authority-tiers.yaml` -- tier configuration with all levels. `transcript-tier-enforcement.md` -- transcript showing action allow and deny based on tier. |
| 68 | Approval modal + audit history | `test-run-approval-modal.log` -- unit tests for approval gate and audit writer. `screenshot-approval-modal.png` -- approval modal with actor and timestamp fields. `screenshot-audit-log.png` -- audit history panel. `transcript-approval-audit.md` -- approval flow with audit trail transcript. |
| 69 | Dangerous action deny/gate rules | `test-run-dangerous-action.log` -- unit tests for action classifier and block handler. `transcript-dangerous-action-deny.md` -- transcript showing destructive action denied. `transcript-dangerous-action-gate.md` -- transcript showing gated action requiring escalated approval. `security-scan-action-rules.json` -- security scan of action classification logic. |
| 70 | CI/CD, build, package, release, rollback panels | `test-run-cicd-pipeline.log` -- unit tests for CI runner and status reporter. `screenshot-pipeline-status.png` -- pipeline status panel with per-stage pass/fail. `build-release-candidate.log` -- complete build output for a release candidate. `transcript-release-rollback.md` -- release and rollback transcript. |
| 71 | Adversarial final audit | `adversarial-audit-report.json` -- structured audit report covering all subsystems. `adversarial-attack-log.md` -- log of all attack vectors attempted with outcomes. `drift-scan-final.json` -- final drift scan comparing implementation against truth matrix. `security-scan-full.json` -- full-system security scan output. `test-run-adversarial.log` -- adversarial test suite output. |
| 72 | Release verdict + packaging | `release-verdict.json` -- final release verdict with pass/fail per block. `release-manifest.json` -- artifact manifest with SHA-256 hashes for every release file. `build-release-final.log` -- final release build output. `truth-matrix-snapshot.md` -- frozen snapshot of truth matrix at release time. `defect-ledger-snapshot.md` -- frozen snapshot of defect ledger at release time. `validation-release-integrity.json` -- integrity verification of all release artifacts. |

---

## Release Evidence Bundle

The `evidence/release/v4.0.0/` directory collects the final evidence for the release. This
is assembled from individual phase evidence after all phases pass.

### Required Release Contents

| File / Directory | Source | Purpose |
|-----------------|--------|---------|
| `acceptance-reports/` | Copies of all 72 ACCEPTANCE_REPORT.md files | Proof every phase was reviewed |
| `screenshots/` | Key screenshots from all UI phases | Visual proof of implemented features |
| `test-logs/` | Final test run logs from all test suites | Proof all tests pass at release commit |
| `truth-matrix-snapshot.md` | Copy of `02_TRUTH/FEATURE_TRUTH_MATRIX.md` at release | Frozen record of feature status |
| `defect-ledger-snapshot.md` | Copy of `02_TRUTH/DEFECT_LEDGER.md` at release | Frozen record of all defects |
| `release-verdict.json` | Phase 72 output | Final pass/fail verdict per block |
| `release-manifest.json` | Phase 72 output | Artifact hashes for tamper detection |
| `adversarial-audit-report.json` | Phase 71 output | Full adversarial audit results |
| `drift-scan-final.json` | Phase 71 output | Final drift scan proving no divergence |

---

## Validation

### How to Verify an Evidence Bundle

Run this check for any phase before closing it:

```bash
# Verify the evidence directory exists and has files
PHASE=01
BLOCK=block-a
ls -la docs/kilocode_v4_kit/evidence/$BLOCK/phase-$PHASE/

# Verify the acceptance report exists
test -f docs/kilocode_v4_kit/evidence/$BLOCK/phase-$PHASE/ACCEPTANCE_REPORT.md && echo "PASS" || echo "FAIL: no acceptance report"

# Verify evidence files are committed to git
git status docs/kilocode_v4_kit/evidence/$BLOCK/phase-$PHASE/
```

### Auto-Fail Conditions

A phase evidence bundle automatically fails if:

1. The evidence directory does not exist.
2. The `ACCEPTANCE_REPORT.md` is missing.
3. Any file listed in the Minimum Bundle column (above) is missing.
4. Evidence files are not committed to git.
5. Screenshots show mockups instead of running software.
6. Test logs have been manually edited (truncated, failures removed).
7. Config samples fail schema validation.
8. Evidence was generated from a different commit than the Acceptance Report references.
9. Files contain unredacted secrets (API keys, passwords, tokens).

---

## Cross-Reference

- Acceptance Report Template: `04_ENFORCEMENT/ACCEPTANCE_REPORT_TEMPLATE.md`
- No-Fake-Completion Rules: `04_ENFORCEMENT/NO_FAKE_COMPLETION_AND_NO_DRIFT_RULES.md`
- Release Verdict Template: `04_ENFORCEMENT/RELEASE_VERDICT_TEMPLATE.md`
- Operator Runbook: `04_ENFORCEMENT/OPERATOR_RUNBOOK.md`
- Phase Tracker: `08_TRACKERS/PHASE_TRACKER.csv`
- 72-Phase Execution Plan: `01_MASTER/KILOCODE_FINAL_V4_72_PHASE_EXECUTION_PLAN.md`
- Phase Dependency Map: `01_MASTER/PHASE_DEPENDENCY_MAP.md`
