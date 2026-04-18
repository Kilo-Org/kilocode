# Governance and Release Complete Coverage Spec

Version: 1.0.0
Config path: `config/governance.yaml`

---

## 1. Authority Tier Model

Four tiers of escalating authorization. Every action in the system maps to exactly one required tier.

### Tier Definitions

| Tier | Name                    | Required Actors                            | Use Case                                      |
|------|-------------------------|--------------------------------------------|-----------------------------------------------|
| 0    | System Auto             | None (automated)                           | Logging, telemetry, health checks, read-only  |
| 1    | Operator                | 1 operator                                 | Config changes, non-destructive actions       |
| 2    | Owner + Confirmer       | Owner initiates, 1 confirmer approves      | Deployments, access changes, data mutations   |
| 3    | Full Triad + Judge      | Owner + confirmer + release judge           | Production releases, rollbacks, security patches |

### Action-to-Tier Mapping

| Action                              | Required Tier | Notes                                         |
|--------------------------------------|---------------|-----------------------------------------------|
| Read logs / traces / metrics         | 0             | Unrestricted                                  |
| Health check execution               | 0             | Automated                                     |
| Update non-sensitive config          | 1             | E.g. log levels, UI preferences               |
| Rotate API keys                      | 1             | Operator responsibility                       |
| Add/remove provider                  | 1             | Changes routing, needs operator awareness      |
| Deploy to staging                    | 2             | Owner + confirmer                              |
| Modify permission matrix             | 2             | Access control change                          |
| Delete dataset                       | 2             | Destructive, irreversible                      |
| Modify governance rules              | 2             | Self-referential, needs dual approval          |
| Production release                   | 3             | Full triad + release judge                     |
| Production rollback                  | 3             | Emergency allowed with post-hoc audit          |
| Security patch deployment            | 3             | Even hotfixes need triad sign-off              |
| Delete production data               | 3             | Highest risk, full triad                       |

### Tier Config

```yaml
authority:
  tiers:
    - tier: 0
      name: system_auto
      requires: []
      auto_approve: true

    - tier: 1
      name: operator
      requires: [operator]
      auto_approve: false
      timeout_hours: 24

    - tier: 2
      name: owner_confirmer
      requires: [owner, confirmer]
      auto_approve: false
      timeout_hours: 48

    - tier: 3
      name: full_triad
      requires: [owner, confirmer, release_judge]
      auto_approve: false
      timeout_hours: 72
```

---

## 2. Approval Request Schema

```typescript
interface ApprovalRequest {
  request_id: string;            // UUID v4
  action_type: string;           // e.g. "production_release", "delete_dataset"
  action_description: string;    // human-readable summary of what is being approved
  risk_level: "low" | "medium" | "high" | "critical";
  required_tier: number;         // 0-3
  requested_by: string;          // user/agent ID who initiated
  required_approvers: RequiredApprover[];
  current_approvals: Approval[];
  status: "pending" | "approved" | "denied" | "expired" | "cancelled";
  created_at: string;            // ISO-8601
  expires_at: string;            // ISO-8601, computed from tier timeout
  resolved_at: string | null;    // when final status was set
  notes: string;                 // freeform context from the requester
  evidence: string[];            // paths to supporting artifacts (test reports, scan results)
  related_request_ids: string[]; // linked prior approvals (e.g. staging deploy before prod)
}

interface RequiredApprover {
  role: "operator" | "owner" | "confirmer" | "release_judge";
  user_id: string | null;        // null = any user with the role can approve
  status: "pending" | "approved" | "denied";
}

interface Approval {
  approver_id: string;
  role: string;
  decision: "approved" | "denied";
  timestamp: string;
  comment: string | null;
}
```

### Approval Flow

```
1. Action is requested → ApprovalRequest created with status "pending"
2. Required approvers are notified (via configured notification channel)
3. Each required approver submits decision (approved | denied)
4. If ANY required approver denies → status = "denied", action blocked
5. If ALL required approvers approve → status = "approved", action proceeds
6. If expires_at passes without all approvals → status = "expired", action blocked
7. Requester may cancel at any time → status = "cancelled"
```

---

## 3. Dangerous Action Registry

Actions above a certain risk threshold are registered here with explicit gate conditions.

```typescript
interface DangerousAction {
  action_id: string;             // e.g. "prod_release", "delete_prod_data"
  description: string;
  risk_level: "high" | "critical";
  required_tier: number;         // minimum tier
  deny_conditions: DenyCondition[];
  gate_conditions: GateCondition[];
  auto_deny_after_hours: number; // auto-expire approval requests
  cooldown_minutes: number;      // minimum time between executions
  last_executed_at: string | null;
  requires_evidence: string[];   // required artifact types, e.g. ["test_report", "security_scan"]
}

interface DenyCondition {
  condition_id: string;
  description: string;           // e.g. "Active critical defects in ledger"
  check: string;                 // evaluable expression or function name
  // Examples:
  // "defect_ledger.critical_count > 0"
  // "test_suite.pass_rate < 0.95"
  // "security_scan.high_vulnerabilities > 0"
}

interface GateCondition {
  condition_id: string;
  description: string;           // e.g. "All CI stages green"
  check: string;
  // Examples:
  // "ci_pipeline.all_stages_passed == true"
  // "rollback_tested == true"
  // "changelog_updated == true"
}
```

### Dangerous Action Registry (default entries)

```yaml
dangerous_actions:
  - action_id: prod_release
    description: Deploy a new version to production
    risk_level: critical
    required_tier: 3
    deny_conditions:
      - condition_id: critical_defects
        description: Active critical defects in the defect ledger
        check: "defect_ledger.critical_count > 0"
      - condition_id: failing_tests
        description: Test suite pass rate below 95%
        check: "test_suite.pass_rate < 0.95"
    gate_conditions:
      - condition_id: ci_green
        description: All CI pipeline stages must pass
        check: "ci_pipeline.all_stages_passed == true"
      - condition_id: security_scan
        description: Security scan completed with no high/critical findings
        check: "security_scan.high_vulnerabilities == 0"
      - condition_id: rollback_tested
        description: Rollback procedure tested in staging
        check: "rollback_tested == true"
    auto_deny_after_hours: 72
    cooldown_minutes: 60
    requires_evidence: [test_report, security_scan, changelog]

  - action_id: delete_prod_data
    description: Delete production data
    risk_level: critical
    required_tier: 3
    deny_conditions:
      - condition_id: no_backup
        description: No verified backup exists
        check: "backup.verified == false"
    gate_conditions:
      - condition_id: data_export
        description: Data export completed before deletion
        check: "data_export.completed == true"
    auto_deny_after_hours: 24
    cooldown_minutes: 1440
    requires_evidence: [backup_verification, deletion_justification]

  - action_id: prod_rollback
    description: Roll back production to a previous version
    risk_level: high
    required_tier: 3
    deny_conditions: []
    gate_conditions:
      - condition_id: rollback_target_valid
        description: Target version exists and was previously deployed
        check: "rollback_target.previously_deployed == true"
    auto_deny_after_hours: 4
    cooldown_minutes: 30
    requires_evidence: [incident_report]

  - action_id: modify_governance
    description: Change governance rules or tier requirements
    risk_level: high
    required_tier: 2
    deny_conditions: []
    gate_conditions:
      - condition_id: diff_review
        description: Governance config diff reviewed by confirmer
        check: "governance_diff.reviewed == true"
    auto_deny_after_hours: 48
    cooldown_minutes: 0
    requires_evidence: [config_diff]
```

---

## 4. Audit Record Schema

Every action -- allowed, denied, or gated -- produces an audit record.

```typescript
interface AuditRecord {
  record_id: string;             // UUID v4
  timestamp: string;             // ISO-8601
  actor: string;                 // user or agent ID who performed the action
  actor_roles: string[];         // roles the actor held at the time
  action: string;                // action_id or free-form action description
  action_type: string;           // category, e.g. "release", "config_change", "data_delete"
  target: string;                // what was acted upon (resource ID, path, etc.)
  result: "allowed" | "denied" | "gated" | "expired" | "error";
  tier_used: number;             // which tier was invoked
  tier_required: number;         // minimum tier for this action
  approvers: AuditApprover[];
  approval_request_id: string | null;  // link to ApprovalRequest if applicable
  evidence_paths: string[];      // paths to artifacts submitted as evidence
  risk_level: string;
  ip_address: string | null;
  session_id: string;
  notes: string;
  duration_ms: number;           // how long the action took to execute
}

interface AuditApprover {
  user_id: string;
  role: string;
  decision: "approved" | "denied";
  timestamp: string;
}
```

### Audit Storage

- Path: `data/governance/audit/YYYY-MM-DD.jsonl`
- Retention: 365 days (1 year), then archived to cold storage.
- Tamper protection: each day's file has an appended SHA-256 checksum line. Checksums are also written to a separate `data/governance/audit/checksums.jsonl`.
- Queryable by: actor, action, result, tier, date range, risk_level.

---

## 5. CI/CD Pipeline Model

```typescript
interface CiCdPipeline {
  pipeline_id: string;           // UUID v4
  version: string;               // semver being built, e.g. "4.2.0"
  commit_sha: string;
  branch: string;
  triggered_by: string;          // user, merge, or schedule
  stages: PipelineStage[];
  status: "running" | "passed" | "failed" | "cancelled";
  started_at: string;
  completed_at: string | null;
  total_duration_seconds: number | null;
  artifacts: ArtifactRef[];
  gate_results: GateResult[];
}

interface PipelineStage {
  name: "lint" | "test" | "build" | "package" | "stage" | "release" | "monitor";
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  artifacts: ArtifactRef[];
  logs_path: string;             // e.g. "data/ci/logs/{pipeline_id}/lint.log"
  gate_result: GateResult | null;
  error: string | null;
  retry_count: number;
}

interface ArtifactRef {
  name: string;                  // e.g. "kilocode-4.2.0.vsix"
  path: string;
  size_bytes: number;
  checksum: string;              // SHA-256
  type: "vsix" | "binary" | "report" | "log" | "docker_image";
}

interface GateResult {
  gate_name: string;             // e.g. "test_pass_rate", "security_scan"
  passed: boolean;
  details: string;
  checked_at: string;
}
```

### Pipeline Stages Detail

```
1. LINT
   - ESLint, Prettier, type-check (tsc --noEmit)
   - Gate: zero errors (warnings allowed)
   - Artifacts: lint-report.json

2. TEST
   - Unit tests (vitest), integration tests
   - Gate: pass rate >= 95%, no critical test failures
   - Artifacts: test-report.json, coverage-report.html

3. BUILD
   - TypeScript compilation, bundling (esbuild/vite)
   - Gate: zero build errors
   - Artifacts: dist/

4. PACKAGE
   - VSIX packaging, binary builds
   - Gate: package integrity check (unpack and verify)
   - Artifacts: kilocode-{version}.vsix, binaries

5. STAGE
   - Deploy to staging environment
   - Run smoke tests against staging
   - Gate: smoke tests pass, no regressions
   - Artifacts: staging-test-report.json

6. RELEASE
   - Requires Tier 3 approval (full triad + release judge)
   - Publish to marketplace / distribution channels
   - Gate: all prior stages passed, approval obtained, no deny_conditions met
   - Artifacts: release-manifest.json

7. MONITOR
   - Post-release health monitoring (30 min window)
   - Watch error rates, crash reports, user feedback
   - Gate: error rate < 0.1%, no P0 incidents
   - Artifacts: monitoring-report.json
```

---

## 6. Release Checklist

Codified as a data structure that must be fully satisfied before a release can proceed.

```typescript
interface ReleaseChecklist {
  checklist_id: string;
  version: string;               // e.g. "4.2.0"
  pipeline_id: string;
  items: ChecklistItem[];
  all_passed: boolean;           // computed: all items have status "passed"
  created_at: string;
  completed_at: string | null;
  signed_off_by: string | null;  // release judge who signs off
}

interface ChecklistItem {
  item_id: string;
  category: string;
  description: string;
  status: "pending" | "passed" | "failed" | "skipped";
  evidence_path: string | null;
  checked_by: string | null;
  checked_at: string | null;
  notes: string;
  required: boolean;             // if true, must pass for release to proceed
}
```

### Default Checklist Items

| Category         | Description                                                | Required |
|------------------|------------------------------------------------------------|----------|
| version          | Version number follows semver and is incremented correctly | yes      |
| changelog        | CHANGELOG.md updated with all user-facing changes          | yes      |
| test_results     | All tests pass with >= 95% pass rate                       | yes      |
| coverage         | Code coverage >= 80% (no regression from previous release) | yes      |
| security_scan    | Security scan completed, zero high/critical findings       | yes      |
| rollback_tested  | Rollback from this version to previous tested in staging   | yes      |
| docs_updated     | User-facing docs updated for new/changed features          | yes      |
| truth_matrix     | Truth matrix verified (all provider role assignments valid) | yes      |
| defect_ledger    | Defect ledger has zero critical and zero high open items   | yes      |
| performance      | No performance regressions (p95 latency within 10%)        | yes      |
| accessibility    | Accessibility audit passed (no new a11y violations)        | no       |
| license_check    | No new dependencies with incompatible licenses             | yes      |

---

## 7. Rollback Protocol

### Trigger Conditions

A rollback is triggered when ANY of these occur within 30 minutes of release:

1. Error rate exceeds 0.5% (5x baseline)
2. P0 incident reported
3. Crash rate exceeds 0.1%
4. Data corruption detected
5. Security vulnerability discovered in released code
6. Manual trigger by operator (Tier 3 approval required unless emergency)

### Emergency Override

In a P0 incident, a single operator can initiate rollback with `emergency: true` flag. This bypasses Tier 3 approval but requires post-hoc audit within 24 hours.

```typescript
interface RollbackRequest {
  rollback_id: string;
  trigger: "error_rate" | "p0_incident" | "crash_rate" | "data_corruption" | "security" | "manual";
  emergency: boolean;
  current_version: string;
  target_version: string;        // version to roll back to
  requested_by: string;
  approval_request_id: string | null;  // null if emergency
  started_at: string;
  status: "initiated" | "in_progress" | "completed" | "failed" | "aborted";
}
```

### Rollback Steps

```
1. INITIATE
   - Create RollbackRequest
   - If not emergency: create ApprovalRequest (Tier 3) and wait
   - If emergency: proceed immediately, log emergency override

2. HALT DEPLOYMENT
   - Stop any in-progress deployments
   - Disable auto-deploy triggers
   - Set release pipeline status to "cancelled"

3. REVERT
   - Switch production to target_version artifacts
   - For VSIX: unpublish current, re-publish previous
   - For services: roll container image tag to target_version

4. VERIFY
   - Run smoke tests against rolled-back version
   - Check error rate returns to baseline
   - Verify all health checks pass
   - Wait 15 minutes monitoring window

5. NOTIFY
   - Notify all stakeholders (owner, confirmer, release judge, affected users)
   - Create incident record
   - Link to rollback audit trail

6. POST-ROLLBACK AUDIT
   - Audit record created with full details
   - If emergency: schedule post-hoc Tier 3 review within 24 hours
   - Root cause analysis initiated
   - Defect ledger updated
```

### Verification Checks

```typescript
interface RollbackVerification {
  rollback_id: string;
  checks: VerificationCheck[];
  all_passed: boolean;
  verified_at: string;
}

interface VerificationCheck {
  check_name: string;
  passed: boolean;
  details: string;
  timestamp: string;
}
```

Default checks:
- `health_endpoints_responding`: all provider health checks return 200
- `error_rate_normal`: error rate below 0.1% for 15 minutes
- `smoke_tests_pass`: core smoke test suite passes
- `no_data_corruption`: data integrity checks pass
- `version_correct`: running version matches target_version

---

## 8. Error Codes

| Code                   | Scope       | Description                                                  | Recovery                                              |
|------------------------|-------------|--------------------------------------------------------------|-------------------------------------------------------|
| GOV_APPROVAL_DENIED    | Governance  | One or more required approvers denied the request            | Address concerns, resubmit with changes               |
| GOV_TIER_INSUFFICIENT  | Governance  | Actor's tier is below the required tier for the action       | Escalate to actor with sufficient tier                 |
| GOV_ACTION_BLOCKED     | Governance  | A deny_condition evaluated to true                           | Fix the blocking condition (e.g. close critical defects)|
| GOV_APPROVAL_EXPIRED   | Governance  | Approval request timed out before all approvers responded    | Resubmit approval request                             |
| GOV_COOLDOWN_ACTIVE    | Governance  | Action attempted before cooldown period elapsed              | Wait for cooldown, or request emergency override       |
| GOV_EVIDENCE_MISSING   | Governance  | Required evidence artifacts not attached to approval request | Attach required evidence and resubmit                 |
| GOV_ROLLBACK_FAILED    | Release     | Rollback procedure failed at one of the steps               | Manual intervention required, escalate to Tier 3       |
| REL_BUILD_FAILED       | Release     | CI/CD build stage failed                                     | Fix build errors, re-trigger pipeline                 |
| REL_TEST_FAILED        | Release     | CI/CD test stage failed (pass rate below threshold)          | Fix failing tests, re-trigger pipeline                |
| REL_GATE_BLOCKED       | Release     | A release gate condition was not met                         | Satisfy the gate condition, re-check                  |
| REL_VERSION_CONFLICT   | Release     | Version number already exists or is not properly incremented | Correct version in package.json / manifest            |
| REL_ARTIFACT_CORRUPT   | Release     | Package artifact checksum verification failed                | Re-run package stage                                  |
| REL_MONITOR_ALERT      | Release     | Post-release monitoring detected anomaly                     | Investigate, consider rollback                        |

### Error Response Envelope

```typescript
interface GovernanceError {
  error_code: string;
  message: string;
  action_id: string;
  actor: string;
  tier_required: number;
  tier_available: number;
  timestamp: string;
  approval_request_id: string | null;
  blocking_conditions: string[];  // which deny_conditions or gate_conditions failed
  details: Record<string, unknown>;
}
```

---

## 9. Config Path

Primary configuration: `config/governance.yaml`

```
config/
  governance.yaml           # tiers, dangerous actions, checklist defaults
  governance.local.yaml     # local overrides (gitignored)
  ci-pipeline.yaml          # pipeline stage definitions and gates
  release-checklist.yaml    # default checklist items
```

Data paths:
- `data/governance/audit/YYYY-MM-DD.jsonl` -- audit trail
- `data/governance/audit/checksums.jsonl` -- daily checksum log
- `data/governance/approvals/` -- active and historical approval requests
- `data/ci/logs/{pipeline_id}/` -- CI/CD stage logs
- `data/ci/artifacts/{pipeline_id}/` -- build artifacts
- `data/releases/{version}/` -- release manifests and checklists

---

## Acceptance Criteria

1. A high-risk action (e.g. `prod_release`) cannot proceed without Tier 3 approval from owner, confirmer, and release judge.
2. A denied action is logged in the audit trail with the denying approver, their comment, and timestamp.
3. An approved action is logged with all approvers, their decisions, and the action outcome.
4. An approval request that exceeds `auto_deny_after_hours` transitions to "expired" automatically.
5. A deny_condition evaluating to true blocks the action with `GOV_ACTION_BLOCKED` regardless of approvals obtained.
6. The release pipeline runs all 7 stages in order; failure at any stage blocks subsequent stages.
7. The release checklist must have all `required: true` items in "passed" status before the release gate opens.
8. A rollback triggered by P0 incident with `emergency: true` proceeds without waiting for Tier 3 approval, and a post-hoc audit is required within 24 hours.
9. Rollback verification checks confirm the system is healthy before the rollback is marked "completed".
10. All audit records include actor, action, result, tier, approvers, and evidence -- queryable by date range, actor, and action type.
