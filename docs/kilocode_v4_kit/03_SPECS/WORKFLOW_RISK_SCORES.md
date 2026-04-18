# Workflow Risk Scoring Model

Version: 1.0.0
Date: 2026-04-17
Status: Draft
Depends on: `KILOCODE_ZEROCLAW_COMPLETE_SPEC.md`, `KILOCODE_GOVERNANCE_RELEASE_COMPLETE_SPEC.md`

---

## 1. Purpose

This document defines the quantitative risk scoring model used to classify every operator action in KiloCode v4. Risk scores drive three downstream decisions:

1. **Write policy** -- whether file writes are auto-applied, buffered for diff review, or blocked pending approval.
2. **Approval routing** -- which governance tier (0-3) must sign off before execution proceeds.
3. **Resource limits** -- CPU, memory, timeout, and disk allocations assigned to the ZeroClaw workspace.

Scores are computed by KiloCode before the task envelope is submitted to Hermes. Hermes may escalate (never downgrade) the resulting risk level based on its own policy evaluation.

---

## 2. Risk Level Definitions

| Level    | Score Range | Description                                           | Auto-approve? | Write Policy | Approval Required             | Governance Tier |
|----------|-------------|-------------------------------------------------------|---------------|--------------|-------------------------------|-----------------|
| Low      | 0-25        | Read-only, no side effects, fully reversible          | Yes           | none         | None                          | 0 (System Auto) |
| Medium   | 26-50       | Write operations, reversible, scoped impact           | Buffered      | buffered     | Operator confirm              | 1 (Operator)    |
| High     | 51-75       | System changes, partially reversible, broad impact    | No            | buffered     | Owner + Confirmer             | 2 (Owner+Conf.) |
| Critical | 76-100      | Destructive, irreversible, cross-system impact        | No            | buffered     | Full Triad + Release Judge    | 3 (Full Triad)  |

### Resource Limits by Risk Level

These defaults are injected into the task envelope's `resource_limits` field. See ZeroClaw spec section 1 for the schema.

| Risk Level | CPU (cores) | Memory (MB) | Timeout (s) | Disk (MB) | Snapshot Required |
|------------|-------------|-------------|-------------|-----------|-------------------|
| Low        | 0.5         | 256         | 30          | 100       | No                |
| Medium     | 1.0         | 512         | 120         | 512       | No (recommended)  |
| High       | 2.0         | 1024        | 300         | 1024      | Yes               |
| Critical   | 2.0         | 2048        | 600         | 2048      | Yes               |

---

## 3. Risk Scoring Formula

```
Final Score = Base Score + Impact Modifiers + Context Modifiers
```

The final score is clamped to the range [0, 100]. If impact or context modifiers push the raw total above 100, the score is capped at 100 (Critical). If modifiers reduce it below 0, the score floors at 0 (Low).

### 3.1 Base Scores by Action Type

Each action type has a fixed base score reflecting its inherent risk when performed against a local development target during normal business hours.

| Action Type          | Base Score | Examples                                              | ZeroClaw task_type mapping            |
|----------------------|------------|-------------------------------------------------------|---------------------------------------|
| Read/query           | 5          | List files, view logs, recall memory, `cat`, `ls`     | `file_scan`                           |
| Local write          | 15         | Edit local file, update config, create file           | `code_generation`, `code_refactor`    |
| Test execution       | 20         | Run unit tests, integration tests                     | `test_execution`                      |
| Remote read          | 20         | SSH `ls`, SFTP browse, remote log tail                | `shell_command` (scope: external)     |
| Dependency install   | 25         | `npm install`, `pip install`, add/remove packages     | `dependency_install`                  |
| Remote write         | 35         | SSH command with side effects, remote file edit       | `shell_command` (scope: external)     |
| Service control      | 45         | Restart service, `docker stop/start`, process mgmt    | `system_config`                       |
| Deploy/release       | 60         | Deploy to production, push release, publish package   | `deployment`                          |
| Data modification    | 65         | Database write, user data change, migration           | `database_migration`                  |
| Infrastructure change| 70         | Network config, DNS, firewall rules, systemd units    | `system_config` (scope: system-wide)  |
| Destructive action   | 85         | Delete data, `rm -rf`, drop database, `file_delete`   | `file_delete`                         |
| Security change      | 90         | Key rotation, permission change, auth config          | `secret_rotation`                     |

### 3.2 Impact Modifiers

Impact modifiers adjust the base score based on the operational environment and reversibility of the action.

| Modifier             | Score Adjustment | Condition                                         | Rationale                                           |
|----------------------|------------------|---------------------------------------------------|-----------------------------------------------------|
| Production target    | +15              | Target is a production environment                | Production failures affect real users               |
| Staging target       | +5               | Target is a staging environment                   | Staging is closer to prod than dev                  |
| Dev/local target     | +0               | Target is local development                       | Lowest blast radius                                 |
| Multi-system scope   | +10              | Action affects more than one system or service    | Wider blast radius, harder to reason about          |
| Irreversible action  | +20              | No rollback or undo is possible                   | Mistakes cannot be corrected                        |
| Has rollback plan    | -10              | Documented rollback procedure exists and is tested| Reduces residual risk; rollback must be ZeroClaw-verified |
| Previously tested    | -5               | Same action was successfully run in staging first | Prior success reduces novelty risk                  |
| Narrow scope         | -5               | Action is scoped to a single file or record       | Limited blast radius                                |
| Broad scope          | +10              | Action touches 10+ files, tables, or services     | Wide blast radius increases chance of side effects  |

### 3.3 Context Modifiers

Context modifiers capture situational factors at the time of execution.

| Modifier                  | Score Adjustment | Condition                                              | Rationale                                               |
|---------------------------|------------------|--------------------------------------------------------|---------------------------------------------------------|
| Business hours            | +0               | Normal operating hours (configurable, default 09:00-17:00 local) | Full support staff available                    |
| Off-hours                 | +5               | Outside business hours                                 | Fewer people available to respond to problems           |
| Active incident response  | -10              | During a declared P0/P1 incident                       | Speed outweighs ceremony; post-hoc audit required       |
| First-time action         | +10              | This action type has never been performed by this operator | Novelty increases error probability               |
| Repeated action           | -5               | Same action completed successfully before by this operator | Familiarity reduces error rate                     |
| Stale approval            | +5               | Approval was granted more than 4 hours ago             | Conditions may have changed since approval              |
| Concurrent operations     | +5               | Other high/critical operations are in progress         | Interleaved mutations are harder to debug               |

---

## 4. Risk Score to Action Mapping: All 12 Workflows

The following table maps each of the 12 operator workflows (defined in Phase 11) to their computed risk scores. For each workflow, three scenarios are shown: development target (best case), staging target, and production target (worst case).

### 4.1 Summary Table

| #  | Workflow                        | Base Action          | Base Score | Dev Modifiers      | Dev Final | Dev Level | Prod Modifiers          | Prod Final | Prod Level |
|----|--------------------------------|----------------------|------------|--------------------|-----------|-----------|-----------------------------|------------|------------|
| 1  | SSH Read Command               | Remote read          | 20         | +0                 | 20        | Low       | +15                         | 35         | Medium     |
| 2  | SSH Write Command              | Remote write         | 35         | +0                 | 35        | Medium    | +15                         | 50         | Medium     |
| 3  | SFTP Upload                    | Remote write         | 35         | +0                 | 35        | Medium    | +15                         | 50         | Medium     |
| 4  | SFTP Download                  | Remote read          | 20         | +0                 | 20        | Low       | +15                         | 35         | Medium     |
| 5  | Docker Build & Run             | Service control      | 45         | +0                 | 45        | Medium    | +15                         | 60         | High       |
| 6  | Docker Compose Up              | Service control      | 45         | +0                 | 45        | Medium    | +15, +10 (multi-system)     | 70         | High       |
| 7  | Remote Service Restart         | Service control      | 45         | +0                 | 45        | Medium    | +15                         | 60         | High       |
| 8  | Remote Log Tail                | Remote read          | 20         | +0                 | 20        | Low       | +15                         | 35         | Medium     |
| 9  | Database Query (read-only)     | Read/query           | 5          | +0                 | 5         | Low       | +15                         | 20         | Low        |
| 10 | Database Migration             | Data modification    | 65         | +0                 | 65        | High      | +15, +20 (irreversible)     | 100        | Critical   |
| 11 | Deploy to Environment          | Deploy/release       | 60         | +0                 | 60        | High      | +15                         | 75         | High       |
| 12 | Secret/Key Rotation            | Security change      | 90         | +0                 | 90        | Critical  | +15                         | 100        | Critical   |

### 4.2 Detailed Workflow Scoring

#### Workflow 1: SSH Read Command

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Execute a read-only command on a remote host via SSH (e.g., `ls`, `cat`, `df`) |
| Base action     | Remote read                                        |
| Base score      | 20                                                 |
| ZeroClaw type   | `shell_command`                                    |
| Write policy    | `none`                                             |
| Network policy  | `limited` (SSH host only)                          |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval     |
|-------------------------|----------------------------|-------------|------------|--------------|
| Dev/local target        | +0                         | 20          | Low        | Auto-approve |
| Staging target          | +5                         | 25          | Low        | Auto-approve |
| Production target       | +15                        | 35          | Medium     | Operator     |
| Prod + first time       | +15, +10                   | 45          | Medium     | Operator     |

#### Workflow 2: SSH Write Command

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Execute a command with side effects on a remote host via SSH (e.g., `mkdir`, `cp`, config edits) |
| Base action     | Remote write                                       |
| Base score      | 35                                                 |
| ZeroClaw type   | `shell_command`                                    |
| Write policy    | `buffered`                                         |
| Network policy  | `limited` (SSH host only)                          |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval          |
|-------------------------|----------------------------|-------------|------------|-------------------|
| Dev/local target        | +0                         | 35          | Medium     | Operator          |
| Staging target          | +5                         | 40          | Medium     | Operator          |
| Production target       | +15                        | 50          | Medium     | Operator          |
| Prod + irreversible     | +15, +20                   | 70          | High       | Owner + Confirmer |
| Prod + multi-system     | +15, +10                   | 60          | High       | Owner + Confirmer |

#### Workflow 3: SFTP Upload

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Upload files to a remote host via SFTP              |
| Base action     | Remote write                                       |
| Base score      | 35                                                 |
| ZeroClaw type   | `shell_command`                                    |
| Write policy    | `buffered`                                         |
| Network policy  | `limited` (SFTP host only)                         |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval          |
|-------------------------|----------------------------|-------------|------------|-------------------|
| Dev/local target        | +0                         | 35          | Medium     | Operator          |
| Staging target          | +5                         | 40          | Medium     | Operator          |
| Production target       | +15                        | 50          | Medium     | Operator          |
| Prod + broad scope      | +15, +10                   | 60          | High       | Owner + Confirmer |

#### Workflow 4: SFTP Download

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Download files from a remote host via SFTP          |
| Base action     | Remote read                                        |
| Base score      | 20                                                 |
| ZeroClaw type   | `file_scan`                                        |
| Write policy    | `none` (remote side), `buffered` (local write)     |
| Network policy  | `limited` (SFTP host only)                         |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval     |
|-------------------------|----------------------------|-------------|------------|--------------|
| Dev/local target        | +0                         | 20          | Low        | Auto-approve |
| Staging target          | +5                         | 25          | Low        | Auto-approve |
| Production target       | +15                        | 35          | Medium     | Operator     |

#### Workflow 5: Docker Build & Run

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Build a Docker image and run a container            |
| Base action     | Service control                                    |
| Base score      | 45                                                 |
| ZeroClaw type   | `system_config`                                    |
| Write policy    | `buffered`                                         |
| Network policy  | `limited` (registry + build deps)                  |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval          |
|-------------------------|----------------------------|-------------|------------|-------------------|
| Dev/local target        | +0                         | 45          | Medium     | Operator          |
| Staging target          | +5                         | 50          | Medium     | Operator          |
| Production target       | +15                        | 60          | High       | Owner + Confirmer |
| Prod + first time       | +15, +10                   | 70          | High       | Owner + Confirmer |

#### Workflow 6: Docker Compose Up

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Start a multi-container application via Docker Compose |
| Base action     | Service control                                    |
| Base score      | 45                                                 |
| ZeroClaw type   | `system_config`                                    |
| Write policy    | `buffered`                                         |
| Network policy  | `limited` (registry + inter-container)             |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval          |
|-------------------------|----------------------------|-------------|------------|-------------------|
| Dev/local target        | +0 (multi-system +10)      | 55          | High       | Owner + Confirmer |
| Staging target          | +5, +10                    | 60          | High       | Owner + Confirmer |
| Production target       | +15, +10                   | 70          | High       | Owner + Confirmer |
| Prod + irreversible     | +15, +10, +20              | 90          | Critical   | Full Triad        |

Note: Docker Compose inherently involves multiple containers/services, so the multi-system modifier (+10) is always applied.

#### Workflow 7: Remote Service Restart

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Restart a service on a remote host (systemctl, supervisord, etc.) |
| Base action     | Service control                                    |
| Base score      | 45                                                 |
| ZeroClaw type   | `system_config`                                    |
| Write policy    | `none` (restart is imperative, not a file write)   |
| Network policy  | `limited` (SSH host only)                          |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval          |
|-------------------------|----------------------------|-------------|------------|-------------------|
| Dev/local target        | +0                         | 45          | Medium     | Operator          |
| Staging target          | +5                         | 50          | Medium     | Operator          |
| Production target       | +15                        | 60          | High       | Owner + Confirmer |
| Prod + off-hours        | +15, +5                    | 65          | High       | Owner + Confirmer |
| Incident response       | +15, -10                   | 50          | Medium     | Operator          |

#### Workflow 8: Remote Log Tail

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Stream or tail log output from a remote host        |
| Base action     | Remote read                                        |
| Base score      | 20                                                 |
| ZeroClaw type   | `shell_command`                                    |
| Write policy    | `none`                                             |
| Network policy  | `limited` (SSH host only)                          |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval     |
|-------------------------|----------------------------|-------------|------------|--------------|
| Dev/local target        | +0                         | 20          | Low        | Auto-approve |
| Staging target          | +5                         | 25          | Low        | Auto-approve |
| Production target       | +15                        | 35          | Medium     | Operator     |

#### Workflow 9: Database Query (Read-Only)

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Execute a read-only SQL query or NoSQL read         |
| Base action     | Read/query                                         |
| Base score      | 5                                                  |
| ZeroClaw type   | `file_scan`                                        |
| Write policy    | `none`                                             |
| Network policy  | `limited` (database host only)                     |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval     |
|-------------------------|----------------------------|-------------|------------|--------------|
| Dev/local target        | +0                         | 5           | Low        | Auto-approve |
| Staging target          | +5                         | 10          | Low        | Auto-approve |
| Production target       | +15                        | 20          | Low        | Auto-approve |
| Prod + broad scope      | +15, +10                   | 30          | Medium     | Operator     |

Note: Even production read-only queries remain Low unless they are broad (e.g., full table scans that could impact performance).

#### Workflow 10: Database Migration

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Execute a database schema migration or data transformation |
| Base action     | Data modification                                  |
| Base score      | 65                                                 |
| ZeroClaw type   | `database_migration`                               |
| Write policy    | `buffered`                                         |
| Network policy  | `limited` (database host only)                     |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval              |
|-------------------------|----------------------------|-------------|------------|-----------------------|
| Dev/local target        | +0                         | 65          | High       | Owner + Confirmer     |
| Staging target          | +5                         | 70          | High       | Owner + Confirmer     |
| Staging + rollback plan | +5, -10                    | 60          | High       | Owner + Confirmer     |
| Production target       | +15                        | 80          | Critical   | Full Triad            |
| Prod + irreversible     | +15, +20                   | 100         | Critical   | Full Triad            |
| Prod + tested in staging| +15, -5                    | 75          | High       | Owner + Confirmer     |

#### Workflow 11: Deploy to Environment

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Deploy application code or artifacts to an environment |
| Base action     | Deploy/release                                     |
| Base score      | 60                                                 |
| ZeroClaw type   | `deployment`                                       |
| Write policy    | `buffered`                                         |
| Network policy  | `limited` (deploy target + artifact registry)      |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval              |
|-------------------------|----------------------------|-------------|------------|-----------------------|
| Dev/local target        | +0                         | 60          | High       | Owner + Confirmer     |
| Staging target          | +5                         | 65          | High       | Owner + Confirmer     |
| Staging + rollback plan | +5, -10                    | 55          | High       | Owner + Confirmer     |
| Production target       | +15                        | 75          | High       | Owner + Confirmer     |
| Prod + no staging test  | +15, +15 (escalation rule) | 90          | Critical   | Full Triad            |
| Prod + rollback + tested| +15, -10, -5               | 60          | High       | Owner + Confirmer     |

#### Workflow 12: Secret/Key Rotation

| Component       | Value                                              |
|-----------------|----------------------------------------------------|
| Description     | Rotate API keys, tokens, certificates, or credentials |
| Base action     | Security change                                    |
| Base score      | 90                                                 |
| ZeroClaw type   | `secret_rotation`                                  |
| Write policy    | `buffered`                                         |
| Network policy  | `limited` (key management service only)            |

| Scenario               | Modifiers                  | Final Score | Risk Level | Approval              |
|-------------------------|----------------------------|-------------|------------|-----------------------|
| Dev/local target        | +0                         | 90          | Critical   | Full Triad            |
| Staging target          | +5                         | 95          | Critical   | Full Triad            |
| Production target       | +15                        | 100 (capped)| Critical   | Full Triad            |
| Dev + rollback plan     | +0, -10                    | 80          | Critical   | Full Triad            |
| Incident response (any) | -10                        | 80          | Critical   | Full Triad            |

Note: Security changes always resolve to Critical regardless of environment. The base score of 90 ensures this. The only way to reduce the level would be a combination of modifiers totaling -16 or more, which is not achievable under normal conditions.

---

## 5. Escalation Rules

These rules apply after the initial score is computed and can push a workflow into a higher risk level mid-execution or across a sequence of operations.

### 5.1 Threshold Crossing During Execution

If conditions change during execution such that the recomputed score crosses into a higher risk level, Hermes must:

1. **Pause** the executing task (ZeroClaw suspends the job, preserving workspace state).
2. **Recompute** the risk score with current conditions.
3. **Re-route** the task through the approval flow for the new risk level.
4. **Resume** only after the required approvals for the new level are obtained.

Example: An SSH write command (score 35, Medium) discovers that the target host is production (was miscategorized as staging). Recomputed score: 35 + 15 = 50. Still Medium, so execution continues. But if the command also writes to multiple systems (35 + 15 + 10 = 60, High), execution pauses for Owner + Confirmer approval.

### 5.2 Sequential Medium-Risk Accumulation

When multiple medium-risk actions are executed in sequence within a single operator session:

| Condition                        | Action                                              |
|----------------------------------|-----------------------------------------------------|
| 3+ medium-risk actions in 10 min | Escalate the next action to High (require Owner + Confirmer) |
| 5+ medium-risk actions in 30 min | Escalate all subsequent actions to High for the session       |
| Any accumulated session score > 150 | Require session-level re-authorization from Owner            |

Session score = sum of all final scores for actions executed in the current session.

### 5.3 Production Without Staging Test

Any action targeting production that has not been previously tested in staging receives a flat +15 modifier. This modifier stacks with the production target modifier.

| Scenario                                           | Modifier Stack          | Effect                                    |
|----------------------------------------------------|-------------------------|-------------------------------------------|
| Deploy to prod, same version tested in staging     | +15 (prod)              | Normal production scoring                 |
| Deploy to prod, NOT tested in staging              | +15 (prod) + 15 (untested) | +30 total; likely pushes to Critical   |
| SSH write to prod, same command tested in staging  | +15 (prod), -5 (tested) | Net +10                                   |
| SSH write to prod, novel command                   | +15 (prod) + 15 (untested) + 10 (first-time) | +40 total              |

### 5.4 Deny Condition Integration

The following conditions from the Governance Dangerous Action Registry (see `KILOCODE_GOVERNANCE_RELEASE_COMPLETE_SPEC.md` section 3) act as hard blocks regardless of risk score:

| Deny Condition                           | Blocked Actions                        | Override         |
|------------------------------------------|----------------------------------------|------------------|
| `defect_ledger.critical_count > 0`       | Deploy to Environment (prod)           | Full Triad       |
| `test_suite.pass_rate < 0.95`            | Deploy to Environment (prod)           | Full Triad       |
| `backup.verified == false`               | Database Migration (prod, destructive) | Not overridable  |
| `security_scan.high_vulnerabilities > 0` | Deploy to Environment (prod)           | Full Triad       |

When a deny condition is active, the action is blocked with `GOV_ACTION_BLOCKED` even if all approvals are obtained. The deny condition must be resolved before the action can proceed.

---

## 6. Override Protocol

Risk scores may be overridden in exceptional circumstances. Overrides do not change the underlying score; they grant a time-limited waiver to proceed despite the score.

### 6.1 Who Can Override

| Risk Level Being Overridden | Required Override Authority     | Notes                                          |
|-----------------------------|--------------------------------|------------------------------------------------|
| Medium -> Low (auto-approve)| Operator                       | Operator takes responsibility for skipping review |
| High -> Medium              | Owner                          | Owner must provide written justification       |
| Critical -> High            | Owner + Release Judge          | Both must approve; Release Judge reviews risk  |
| Critical -> Medium or Low   | Not permitted                  | Critical actions cannot be reduced below High  |
| Any level during incident   | Single Operator (emergency)    | Post-hoc Tier 3 audit required within 24 hours |

### 6.2 Override Request Schema

```jsonc
{
  "override_id": "ovr-{uuid}",
  "task_id": "task-...",
  "original_score": 75,
  "original_level": "high",
  "requested_level": "medium",
  "requested_by": "operator-id",
  "justification": "string (required, min 50 chars)",
  "approved_by": ["owner-id"],
  "approved_at": "ISO-8601",
  "expires_at": "ISO-8601",
  "emergency": false,
  "audit_required_by": "ISO-8601 | null"
}
```

### 6.3 Override Constraints

| Constraint                | Value                                              |
|---------------------------|----------------------------------------------------|
| Maximum waiver duration   | 4 hours from approval                              |
| Maximum uses per waiver   | 1 (single task execution)                          |
| Reuse of expired waiver   | Not permitted; new override request required        |
| Override during cooldown  | Not permitted unless `emergency: true`              |
| Stacking overrides        | Not permitted; only one active override per task    |

### 6.4 Audit Trail for Overrides

Every override produces an `AuditRecord` (see Governance spec section 4) with:

- `action_type`: `"risk_override"`
- `result`: `"allowed"` or `"denied"`
- `notes`: Must include the justification text from the override request
- `evidence_paths`: Must include the override request JSON

Override audit records are flagged for mandatory review by the Release Judge within 7 days. Unreviewed overrides trigger a notification escalation chain:

1. Day 1-3: Daily notification to Release Judge.
2. Day 4-6: Daily notification to Owner and Release Judge.
3. Day 7: Override is reported as a governance finding in the next release checklist.

---

## 7. Score Computation Examples

### Example A: Routine staging deployment with rollback plan

```
Action:          Deploy to Environment
Base score:      60
Modifiers:
  Staging target:     +5
  Has rollback plan: -10
  Previously tested:  -5 (tested locally first)
Context:
  Business hours:     +0
  Repeated action:   -5 (deployed to staging before)

Final score: 60 + 5 - 10 - 5 + 0 - 5 = 45
Risk level:  Medium
Approval:    Operator confirm
Write policy: buffered
```

### Example B: First-time production database migration

```
Action:          Database Migration
Base score:      65
Modifiers:
  Production target:  +15
  Irreversible:       +20 (DROP COLUMN, no rollback)
  Broad scope:        +10 (affects 15 tables)
Context:
  First-time action:  +10
  Off-hours:          +5

Raw score: 65 + 15 + 20 + 10 + 10 + 5 = 125
Clamped:   100
Risk level: Critical
Approval:   Full Triad + Release Judge
Write policy: buffered
Snapshot:   Required
```

### Example C: Emergency production service restart during incident

```
Action:          Remote Service Restart
Base score:      45
Modifiers:
  Production target:  +15
Context:
  Incident response: -10
  Repeated action:   -5 (restarted this service before)

Final score: 45 + 15 - 10 - 5 = 45
Risk level:  Medium
Approval:    Operator (emergency override available)
Write policy: none
```

### Example D: SSH read command on development server

```
Action:          SSH Read Command
Base score:      20
Modifiers:
  Dev/local target:   +0
Context:
  Business hours:     +0
  Repeated action:   -5

Final score: 20 + 0 + 0 - 5 = 15
Risk level:  Low
Approval:    Auto-approve
Write policy: none
```

---

## 8. Integration Points

### 8.1 KiloCode Task Envelope

KiloCode computes the risk score and maps it to `risk_level` in the task envelope before submission to Hermes:

```
score 0-25   -> risk_level: "low"
score 26-50  -> risk_level: "medium"
score 51-75  -> risk_level: "high"
score 76-100 -> risk_level: "critical"
```

The score itself is included as a custom field in the envelope for auditability:

```jsonc
{
  "task_id": "task-abc123-def456",
  "risk_level": "high",
  "risk_score": 65,
  "risk_breakdown": {
    "base_score": 45,
    "impact_modifiers": [
      { "name": "production_target", "value": 15 },
      { "name": "has_rollback_plan", "value": -10 }
    ],
    "context_modifiers": [
      { "name": "first_time_action", "value": 10 },
      { "name": "business_hours", "value": 0 }
    ],
    "escalation_rules_applied": ["production_without_staging_test"],
    "final_score_clamped": false
  }
}
```

### 8.2 Hermes Policy Evaluation

Hermes receives the score and may escalate:

1. **Scope escalation**: If `allowed_workspace_scope` includes paths outside `project_path`, Hermes adds +10 and recalculates.
2. **Network escalation**: If `network_policy=full` and the computed level is below High, Hermes bumps to at least High.
3. **Write policy enforcement**: If `write_policy=direct` and level is Low, Hermes bumps to Medium and sets `write_policy=buffered`.
4. **Approval chain validation**: If the resulting level is High or Critical and `approval_chain` is empty, Hermes rejects with `ZC_APPROVAL_DENIED`.

Hermes logs any escalation as a separate audit record with `action_type: "risk_escalation"`.

### 8.3 ZeroClaw Resource Mapping

The final risk level (after any Hermes escalation) determines the resource limits applied to the ZeroClaw workspace. See the Resource Limits table in section 2.

### 8.4 Governance Tier Mapping

The final risk level maps to the governance authority tier:

| Risk Level | Governance Tier | Approval Chain                      | Timeout   |
|------------|-----------------|-------------------------------------|-----------|
| Low        | 0               | [] (empty, auto-approved)           | N/A       |
| Medium     | 1               | [operator]                          | 24 hours  |
| High       | 2               | [owner, confirmer]                  | 48 hours  |
| Critical   | 3               | [owner, confirmer, release_judge]   | 72 hours  |

---

## 9. Configuration

Risk scoring parameters are configurable via `config/governance.yaml` under the `risk_scoring` key:

```yaml
risk_scoring:
  # Base scores can be adjusted per deployment
  base_scores:
    read_query: 5
    local_write: 15
    test_execution: 20
    remote_read: 20
    dependency_install: 25
    remote_write: 35
    service_control: 45
    deploy_release: 60
    data_modification: 65
    infrastructure_change: 70
    destructive_action: 85
    security_change: 90

  # Impact modifier values
  impact_modifiers:
    production_target: 15
    staging_target: 5
    dev_local_target: 0
    multi_system_scope: 10
    irreversible_action: 20
    has_rollback_plan: -10
    previously_tested: -5
    narrow_scope: -5
    broad_scope: 10

  # Context modifier values
  context_modifiers:
    business_hours: 0
    off_hours: 5
    incident_response: -10
    first_time_action: 10
    repeated_action: -5
    stale_approval: 5
    concurrent_operations: 5

  # Escalation thresholds
  escalation:
    sequential_medium_count: 3
    sequential_medium_window_minutes: 10
    session_score_reauth_threshold: 150
    production_untested_penalty: 15

  # Business hours (local time)
  business_hours:
    start: "09:00"
    end: "17:00"
    timezone: "local"  # or IANA timezone, e.g. "America/New_York"
```

---

## 10. Acceptance Criteria

| ID    | Criterion                                                                                        | Verification                                                    |
|-------|--------------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| RS-1  | Every workflow action computes a risk score using the formula: base + impact + context            | Unit test: score computation for all 12 workflows               |
| RS-2  | Risk scores correctly map to risk levels (0-25 Low, 26-50 Medium, 51-75 High, 76-100 Critical)   | Unit test: boundary values 25, 26, 50, 51, 75, 76              |
| RS-3  | Production target modifier (+15) is applied when the target environment is production             | Unit test: SSH read on prod scores 35, not 20                   |
| RS-4  | Irreversible action modifier (+20) is applied for destructive operations without rollback         | Unit test: DB migration with DROP scores +20 over base          |
| RS-5  | Has-rollback-plan modifier (-10) is only applied when a ZeroClaw-verified rollback exists         | Integration test: modifier rejected without verified plan       |
| RS-6  | Sequential medium-risk accumulation escalates to High after 3 actions in 10 minutes               | Integration test: 4th medium action in session requires Tier 2  |
| RS-7  | Score crossing a threshold mid-execution triggers pause and re-approval                           | Integration test: environment reclassification pauses job       |
| RS-8  | Risk score breakdown is included in the task envelope for audit                                   | Schema validation: `risk_breakdown` field present               |
| RS-9  | Hermes escalation never downgrades a score; only escalates                                        | Unit test: Hermes cannot reduce risk_level                      |
| RS-10 | Override protocol enforces maximum 4-hour waiver duration                                         | Unit test: expired override rejected                            |
| RS-11 | Override audit records are flagged for Release Judge review within 7 days                         | Integration test: notification chain fires on day 1, 4, 7       |
| RS-12 | Deny conditions block actions regardless of override or approval status                           | Integration test: approved + overridden action still blocked    |
| RS-13 | Security changes (base 90) always resolve to Critical regardless of beneficial modifiers          | Unit test: secret rotation with all possible reductions >= 76   |
| RS-14 | All 12 workflows have documented risk scores for dev, staging, and production targets             | Doc review: section 4.2 covers all 12 workflows                |
| RS-15 | Configuration file allows adjustment of all base scores, modifiers, and thresholds                | Config validation: all values in `risk_scoring` key are honored |
