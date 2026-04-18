# Approval Requirements Map

Date: 2026-04-17
Version: 1.0.0
Phase: 13 of 72-phase plan
Config path: `config/governance.yaml`

---

## Authority Tiers

Four tiers of escalating authorization. Every action in the system maps to exactly one required tier. Tier assignments are defined in `config/governance.yaml` under `authority.tiers`.

| Tier | Name | Required Actors | Can Approve | Timeout |
|------|------|-----------------|-------------|---------|
| 0 | System Auto | None (automated) | Low-risk read-only actions; logging, telemetry, health checks | N/A (immediate) |
| 1 | Operator | 1 operator | Medium-risk scoped writes; config changes, non-destructive mutations | 24 hours |
| 2 | Owner + Confirmer | Owner initiates, 1 confirmer approves | High-risk system changes; deployments, access changes, data mutations | 48 hours |
| 3 | Full Triad + Judge | Owner + Confirmer + Release Judge | Critical/destructive actions; production releases, rollbacks, security patches | 72 hours |

### Agent Roles (from 24-Agent Triad Map)

| Role | Agents | Authority |
|------|--------|-----------|
| Program Director | Agent 1 | Breaks ties across subsystems, convenes tribunals |
| Release Judge | Agent 2 | Final pass/fail authority on every release gate |
| Evidence Steward | Agent 3 | Maintains truth matrix, defect ledger, evidence bundles |
| Subsystem Owner | Agents 4, 7, 10, 13, 16, 19, 22 | Initiates actions, marks ready |
| Subsystem Confirmer | Agents 5, 8, 11, 14, 17, 20, 23 | Verifies evidence, co-signs approvals |
| Subsystem Challenger | Agents 6, 9, 12, 15, 18, 21, 24 | Stress-tests decisions, may reject at Tier 3 |

---

## Action-to-Approval Matrix

### SSH Subsystem (Agents 7-9: SSH/VPS Owner, Confirmer, Challenger)

| # | Action | Risk Level | Required Tier | Approvers | Timeout | Error on Deny | Evidence Required |
|---|--------|-----------|---------------|-----------|---------|---------------|-------------------|
| 1 | Read remote logs / metrics | Low | 0 | Auto | N/A | -- | None |
| 2 | SFTP list / stat (read-only browse) | Low | 0 | Auto | N/A | -- | None |
| 3 | SFTP read (download file) | Low | 0 | Auto | N/A | -- | None |
| 4 | SSH shell command (read-only) | Low | 0 | Auto | N/A | -- | None |
| 5 | SSH shell command (write) | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Command text |
| 6 | SFTP write (upload file) | Medium | 1 | Operator (with diff review) | 10 min | GOV_APPROVAL_DENIED | Unified diff |
| 7 | SFTP mkdir / rename | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Path list |
| 8 | Remote file edit + save | Medium | 1 | Operator (diff panel confirm) | 10 min | GOV_APPROVAL_DENIED | Unified diff |
| 9 | SFTP rm (file delete) | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | File path, size |
| 10 | SFTP rm -r (recursive delete) | High | 2 | SSH/VPS Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Directory tree listing |
| 11 | SFTP chmod (permission change) | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Old/new mode |
| 12 | SSH key rotation | Critical | 3 | Full triad + Release Judge | 30 min | GOV_APPROVAL_DENIED | Key fingerprint, expiry |
| 13 | SSH profile create / update | Low | 0 | Auto | N/A | -- | Profile diff |
| 14 | SSH profile delete | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Profile ID |

### VPS Subsystem (Agents 7-9: SSH/VPS Owner, Confirmer, Challenger)

| # | Action | Risk Level | Required Tier | Approvers | Timeout | Error on Deny | Evidence Required |
|---|--------|-----------|---------------|-----------|---------|---------------|-------------------|
| 15 | VPS health check / status poll | Low | 0 | Auto | N/A | -- | None |
| 16 | Docker list / inspect / logs / ps | Low | 0 | Auto | N/A | -- | None |
| 17 | Docker start / restart container | Medium | 1 | Operator (confirmation toast) | 5 min | GOV_APPROVAL_DENIED | Container ID, image |
| 18 | Docker pull image | Medium | 1 | Operator (confirmation toast) | 5 min | GOV_APPROVAL_DENIED | Image tag |
| 19 | Docker stop container | Medium | 1 | Operator (modal confirm) | 5 min | GOV_APPROVAL_DENIED | Container ID |
| 20 | Docker remove container | High | 2 | SSH/VPS Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Container ID, state |
| 21 | Docker compose up | Medium | 1 | Operator | 10 min | GOV_APPROVAL_DENIED | Compose file path |
| 22 | Docker compose down | High | 2 | SSH/VPS Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Compose file, service list |
| 23 | Docker rmi (image remove) | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Image ID, tag |
| 24 | Service restart (systemd) | High | 2 | SSH/VPS Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Service name, unit file |
| 25 | VPS provision (create instance) | High | 2 | SSH/VPS Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Provider, region, spec |
| 26 | VPS destroy (delete instance) | Critical | 3 | Full triad + Release Judge | 30 min | GOV_APPROVAL_DENIED | Instance ID, backup status |

### ZeroClaw Subsystem (Agents 10-12: ZeroClaw Owner, Confirmer, Challenger)

| # | Action | Risk Level | Required Tier | Approvers | Timeout | Error on Deny | Evidence Required |
|---|--------|-----------|---------------|-----------|---------|---------------|-------------------|
| 27 | file_scan task (read-only) | Low | 0 | Auto | N/A | -- | None |
| 28 | code_generation (buffered writes) | Medium | 1 | Operator (review diff) | 10 min | ZC_APPROVAL_DENIED | Diff artifact |
| 29 | code_refactor (project scope) | Medium | 1 | Operator (review diff) | 10 min | ZC_APPROVAL_DENIED | Diff artifact |
| 30 | code_refactor (system-wide) | High | 2 | ZeroClaw Owner + Confirmer | 15 min | ZC_APPROVAL_DENIED | Diff, scope paths |
| 31 | test_execution (project scope) | Medium | 1 | Operator | 10 min | ZC_APPROVAL_DENIED | Test plan |
| 32 | test_execution (system-wide) | High | 2 | ZeroClaw Owner + Confirmer | 15 min | ZC_APPROVAL_DENIED | Test plan, scope |
| 33 | dependency_install (project) | Medium | 1 | Operator | 10 min | ZC_APPROVAL_DENIED | Package list |
| 34 | dependency_install (global) | High | 2 | ZeroClaw Owner + Confirmer | 15 min | ZC_APPROVAL_DENIED | Package list, scope |
| 35 | system_config change | High | 2 | ZeroClaw Owner + Confirmer | 15 min | ZC_APPROVAL_DENIED | Config diff |
| 36 | system_config change (external) | Critical | 3 | Full triad + Release Judge | 30 min | ZC_APPROVAL_DENIED | Config diff, impact |
| 37 | database_migration | Critical | 3 | Full triad + Release Judge | 30 min | ZC_APPROVAL_DENIED | Migration SQL, rollback |
| 38 | deployment task | Critical | 3 | Full triad + Release Judge | 30 min | ZC_APPROVAL_DENIED | Deploy manifest |
| 39 | shell_command (project scope) | Medium | 1 | Operator | 10 min | ZC_APPROVAL_DENIED | Command text |
| 40 | shell_command (system-wide) | High | 2 | ZeroClaw Owner + Confirmer | 15 min | ZC_APPROVAL_DENIED | Command text, scope |
| 41 | shell_command (external/network) | Critical | 3 | Full triad + Release Judge | 30 min | ZC_APPROVAL_DENIED | Command, network policy |
| 42 | file_delete (project scope) | Medium | 1 | Operator | 10 min | ZC_APPROVAL_DENIED | File list |
| 43 | file_delete (system-wide) | High | 2 | ZeroClaw Owner + Confirmer | 15 min | ZC_APPROVAL_DENIED | File list, scope |
| 44 | secret_rotation | Critical | 3 | Full triad + Release Judge | 30 min | ZC_APPROVAL_DENIED | Secret ref, rotation plan |
| 45 | ZeroClaw manual rollback | High | 2 | ZeroClaw Owner + Confirmer | 15 min | ZC_ROLLBACK_FAILED | Snapshot ID, trigger reason |

### Provider Routing Subsystem (Agents 13-15: Routing Owner, Confirmer, Challenger)

| # | Action | Risk Level | Required Tier | Approvers | Timeout | Error on Deny | Evidence Required |
|---|--------|-----------|---------------|-----------|---------|---------------|-------------------|
| 46 | Health check execution | Low | 0 | Auto | N/A | -- | None |
| 47 | Route trace query | Low | 0 | Auto | N/A | -- | None |
| 48 | Provider lane override | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Override reason |
| 49 | Add provider to registry | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Provider config |
| 50 | Remove provider from registry | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Provider ID |
| 51 | Modify role matrix assignment | High | 2 | Routing Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Old/new matrix diff |
| 52 | Change fallback chain order | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Chain diff |
| 53 | Rotate provider API key | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Key ref |
| 54 | Force circuit breaker reset | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Provider ID, reason |
| 55 | Private data routing override to cloud | Critical | 3 | Full triad + Release Judge | 30 min | ROUTE_WRONG_ROLE | Justification, data class |

### Memory Subsystem (Agents 16-18: Memory Owner, Confirmer, Challenger)

| # | Action | Risk Level | Required Tier | Approvers | Timeout | Error on Deny | Evidence Required |
|---|--------|-----------|---------------|-----------|---------|---------------|-------------------|
| 56 | Memory recall (read) | Low | 0 | Auto | N/A | -- | None |
| 57 | Memory write (session scope) | Low | 0 | Auto | N/A | -- | None |
| 58 | Memory write (project scope) | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Key, value preview |
| 59 | Memory write (global scope) | Medium | 1 | Operator | 5 min | MEM_SCOPE_DENIED | Key, value preview |
| 60 | Memory delete (session scope) | Low | 0 | Auto | N/A | -- | None |
| 61 | Memory delete (project scope) | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Entry ID, key |
| 62 | Memory delete (global scope) | High | 2 | Memory Owner + Confirmer | 15 min | MEM_SCOPE_DENIED | Entry ID, key, value |
| 63 | Memory purge (bulk delete) | High | 2 | Memory Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Query, entry count |
| 64 | Cross-agent recall (other project) | Medium | 1 | Operator | 5 min | MEM_SCOPE_DENIED | Agent ID, target project |
| 65 | Modify memory permissions matrix | High | 2 | Memory Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Permission diff |
| 66 | Shiba auth token rotation | High | 2 | Memory Owner + Confirmer | 15 min | MEM_AUTH_EXPIRED | Token ref |

### Training / GPU Subsystem (Agents 19-21: Training Owner, Confirmer, Challenger)

| # | Action | Risk Level | Required Tier | Approvers | Timeout | Error on Deny | Evidence Required |
|---|--------|-----------|---------------|-----------|---------|---------------|-------------------|
| 67 | Dataset register / validate | Low | 0 | Auto | N/A | -- | None |
| 68 | Dataset query / browse | Low | 0 | Auto | N/A | -- | None |
| 69 | Training job launch (local GPU) | Medium | 1 | Operator | 10 min | GOV_APPROVAL_DENIED | Job config, GPU info |
| 70 | Training job launch (remote GPU) | High | 2 | Training Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Job config, cost estimate |
| 71 | Training job pause / resume | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Job ID, checkpoint |
| 72 | Training job cancel | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Job ID |
| 73 | Checkpoint delete | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Checkpoint ID |
| 74 | Checkpoint resume (from corrupted) | High | 2 | Training Owner + Confirmer | 15 min | TRAIN_CHECKPOINT_CORRUPTED | Checkpoint integrity report |
| 75 | Model export (local format) | Medium | 1 | Operator | 10 min | GOV_APPROVAL_DENIED | Export config |
| 76 | Model export to production | Critical | 3 | Full triad + Release Judge | 30 min | GOV_APPROVAL_DENIED | Export config, val_loss, test_report |
| 77 | Dataset delete | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Dataset ID |
| 78 | Hyperparameter override (preset) | Low | 0 | Auto | N/A | -- | None |
| 79 | Remote GPU provider key rotation | High | 2 | Training Owner + Confirmer | 15 min | TRAIN_REMOTE_AUTH_FAILED | Provider, key ref |

### Governance / Release Subsystem (Agents 22-24: Governance Owner, QA/E2E Owner, Governance Challenger)

| # | Action | Risk Level | Required Tier | Approvers | Timeout | Error on Deny | Evidence Required |
|---|--------|-----------|---------------|-----------|---------|---------------|-------------------|
| 80 | Read audit logs | Low | 0 | Auto | N/A | -- | None |
| 81 | Query approval history | Low | 0 | Auto | N/A | -- | None |
| 82 | Update non-sensitive config | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Config diff |
| 83 | Modify permission matrix | High | 2 | Governance Owner + QA/E2E Owner | 15 min | GOV_APPROVAL_DENIED | Permission diff |
| 84 | Modify governance rules | High | 2 | Governance Owner + QA/E2E Owner | 15 min | GOV_APPROVAL_DENIED | Governance config diff |
| 85 | Config / secret change | High | 2 | Governance Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Config diff |
| 86 | Deploy to staging | High | 2 | Governance Owner + QA/E2E Owner | 15 min | GOV_APPROVAL_DENIED | Pipeline ID, stage results |
| 87 | Production deploy / release | Critical | 3 | Full triad + Release Judge | 60 min | GOV_APPROVAL_DENIED | test_report, security_scan, changelog |
| 88 | Production rollback (planned) | Critical | 3 | Full triad + Release Judge | 30 min | GOV_ROLLBACK_FAILED | incident_report |
| 89 | Production rollback (emergency) | Critical | 3* | Single operator (post-hoc audit in 24h) | Immediate | GOV_ROLLBACK_FAILED | incident_report (post-hoc) |
| 90 | Release to marketplace | Critical | 3 | Full triad + Release Judge | 60 min | REL_GATE_BLOCKED | release_checklist, all 12 items passed |
| 91 | Security patch deployment | Critical | 3 | Full triad + Release Judge | 30 min | GOV_APPROVAL_DENIED | security_scan, patch_diff |
| 92 | Rollback production | High | 2 | Governance Owner + QA/E2E Owner | 15 min | GOV_ROLLBACK_FAILED | Rollback target, incident |
| 93 | Delete production data | Critical | 3 | Full triad + Release Judge | 30 min | GOV_APPROVAL_DENIED | backup_verification, deletion_justification |
| 94 | Delete dataset (irreversible) | High | 2 | Governance Owner + QA/E2E Owner | 15 min | GOV_APPROVAL_DENIED | Dataset ID, backup ref |
| 95 | Tribunal convening | High | 2 | Program Director + Evidence Steward | 15 min | GOV_APPROVAL_DENIED | Defect ID, severity |

### Speech Subsystem (no dedicated triad -- governed by Extension Host rules)

| # | Action | Risk Level | Required Tier | Approvers | Timeout | Error on Deny | Evidence Required |
|---|--------|-----------|---------------|-----------|---------|---------------|-------------------|
| 96 | Change TTS provider selection | Low | 0 | Auto | N/A | -- | None |
| 97 | Update voice/rate/pitch settings | Low | 0 | Auto | N/A | -- | None |
| 98 | Add TTS provider API key | Low | 0 | Auto | N/A | -- | None |
| 99 | Modify CSP connect-src allowlist | High | 2 | Architecture Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Endpoint list, justification |

### Architecture / Cross-Cutting (Agents 4-6: Architecture Owner, Confirmer, Challenger)

| # | Action | Risk Level | Required Tier | Approvers | Timeout | Error on Deny | Evidence Required |
|---|--------|-----------|---------------|-----------|---------|---------------|-------------------|
| 100 | Modify subsystem boundary | High | 2 | Architecture Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Boundary diff |
| 101 | Add new service dependency | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Dependency graph |
| 102 | Change layer model rule | Critical | 3 | Full triad + Release Judge | 30 min | GOV_APPROVAL_DENIED | Layer rule diff, impact |
| 103 | Add external endpoint to CSP | High | 2 | Architecture Owner + Confirmer | 15 min | GOV_APPROVAL_DENIED | Endpoint, justification |
| 104 | Modify postMessage type union | Medium | 1 | Operator | 5 min | GOV_APPROVAL_DENIED | Type diff |

---

## Risk Scoring

Risk level is computed from a numerical score. The score determines the tier.

| Score Range | Risk Level | Required Tier |
|-------------|-----------|---------------|
| 0 - 25 | Low | 0 (Auto) |
| 26 - 50 | Medium | 1 (Operator) |
| 51 - 75 | High | 2 (Owner + Confirmer) |
| 76 - 100 | Critical | 3 (Full Triad + Judge) |

### Scoring Factors

| Factor | Weight | Description |
|--------|--------|-------------|
| Data sensitivity | 0 - 30 | public=0, internal=10, confidential=20, restricted=30 |
| Reversibility | 0 - 25 | fully reversible=0, partially=10, irreversible=25 |
| Blast radius | 0 - 20 | session=0, project=5, system=10, production=20 |
| Network exposure | 0 - 15 | none=0, limited=5, full=15 |
| Cost impact | 0 - 10 | free=0, low=3, medium=6, high=10 |

### Escalation Rules (from ZeroClaw spec)

1. If `network_policy=full`, bump risk by one tier (low->medium, medium->high, etc.).
2. If `write_policy=direct` and risk is below medium, bump to medium.
3. If `allowed_workspace_scope` includes paths outside `project_path`, bump by one tier.
4. If `approval_chain` is empty and risk is high or critical, Hermes rejects with `ZC_APPROVAL_DENIED`.

---

## Approval Flows

### Tier 0 -- Auto-Approve

```
Action requested
    |
    v
Risk check (score <= 25)
    |
    v
Execute immediately
    |
    v
Log to audit trail
    |  record_id, timestamp, actor, action,
    |  result="allowed", tier_used=0, tier_required=0
    v
Done
```

No UI interaction. Logged with `result: "allowed"` in `data/governance/audit/YYYY-MM-DD.jsonl`.

### Tier 1 -- Operator Confirm

```
Action requested
    |
    v
Risk check (26 <= score <= 50)
    |
    v
Show confirmation modal
    |  - Action description
    |  - Risk score and level
    |  - Affected resources
    |  - Approve / Deny / Defer buttons
    |
    +--- Operator clicks Approve ---+
    |                               |
    +--- Operator clicks Deny ------+--- Log GOV_APPROVAL_DENIED
    |                               |    Notify requester
    +--- Timeout (5-10 min) --------+--- Log GOV_APPROVAL_EXPIRED
    |                                    Deny action
    v
Execute
    |
    v
Log to audit trail
    |  approver_id, decision="approved", tier_used=1
    v
Done
```

### Tier 2 -- Dual Sign-off (Owner + Confirmer)

```
Action requested
    |
    v
Risk check (51 <= score <= 75)
    |
    v
Show approval modal with full detail
    |
    v
Owner reviews and approves
    |  (if Owner denies -> GOV_APPROVAL_DENIED, stop)
    |
    v
Confirmer reviews and approves
    |  (if Confirmer denies -> GOV_APPROVAL_DENIED, stop)
    |
    v
All required approvers signed
    |
    v
Check deny_conditions
    |  (if any evaluate true -> GOV_ACTION_BLOCKED, stop)
    |
    v
Check gate_conditions
    |  (if any fail -> REL_GATE_BLOCKED, stop)
    |
    v
Execute
    |
    v
Log to audit trail
    |  both approver entries, tier_used=2
    v
Done
```

### Tier 3 -- Full Triad + Release Judge

```
Action requested
    |
    v
Risk check (score >= 76)
    |
    v
Show approval modal with full detail
    |  - Action description and risk score
    |  - Affected resources and blast radius
    |  - Rollback available? (yes/no)
    |  - Required evidence list
    |  - Timer countdown
    |
    v
Owner reviews and approves
    |  (if Owner denies -> GOV_APPROVAL_DENIED, stop)
    |
    v
Confirmer reviews and verifies evidence
    |  (if Confirmer denies -> GOV_APPROVAL_DENIED, stop)
    |
    v
Challenger reviews (may reject)
    |  For release actions only; challenger attempts to break
    |  (if Challenger finds critical issue -> GOV_APPROVAL_DENIED, stop)
    |
    v
Release Judge final sign-off
    |  (if Release Judge denies -> GOV_APPROVAL_DENIED, stop)
    |
    v
Check deny_conditions (from Dangerous Action Registry)
    |  defect_ledger.critical_count > 0 -> GOV_ACTION_BLOCKED
    |  test_suite.pass_rate < 0.95 -> GOV_ACTION_BLOCKED
    |  security_scan.high_vulnerabilities > 0 -> GOV_ACTION_BLOCKED
    |
    v
Check gate_conditions
    |  ci_pipeline.all_stages_passed == true
    |  rollback_tested == true
    |  changelog_updated == true
    |
    v
Execute
    |
    v
Log to audit trail
    |  all approver entries, evidence_paths, tier_used=3
    v
Post-execution monitoring (30 min for releases)
```

---

## Approval Modal UI Spec

The approval modal is rendered in the webview at `webview-ui/src/components/governance/ApprovalModal.tsx`. Data flows via postMessage from the extension host `GovernanceExtension.ts`.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| Action description | string | Human-readable summary from `ApprovalRequest.action_description` |
| Risk score | number | Computed score (0-100) |
| Risk level | enum | `low`, `medium`, `high`, `critical` |
| Affected resources | string[] | Paths, IDs, or names of resources impacted |
| Rollback available | boolean | Whether pre-execution snapshot exists |
| Snapshot ID | string or null | Reference to rollback snapshot if available |
| Approver list | ApproverStatus[] | Each approver with role, status (pending/approved/denied) |
| Timer countdown | ISO-8601 | `expires_at` from `ApprovalRequest` |
| Evidence attachments | string[] | Paths to test_report, security_scan, etc. |
| Related approvals | string[] | `related_request_ids` for linked prior approvals |

### Controls

| Control | Behavior |
|---------|----------|
| Approve button | Sets `RequiredApprover.status = "approved"`, posts decision to extension host |
| Deny button | Opens notes field (required), sets `RequiredApprover.status = "denied"` |
| Defer button | Extends timeout by 50% (max one defer per approver) |
| Notes field | Freeform text, required on deny, optional on approve |
| Evidence viewer | Opens linked artifacts in read-only editor tab |

### Visual States

| State | Display |
|-------|---------|
| Pending | Amber badge, countdown timer active |
| Partially approved | Green checks on approved, amber on remaining |
| Approved | All green, "Executing..." status |
| Denied | Red badge, denial reason displayed |
| Expired | Grey badge, `GOV_APPROVAL_EXPIRED` message |

---

## Dangerous Action Registry

The following actions are registered in `config/governance.yaml` under `dangerous_actions` with explicit gate and deny conditions.

### prod_release

| Property | Value |
|----------|-------|
| action_id | `prod_release` |
| risk_level | critical |
| required_tier | 3 |
| cooldown_minutes | 60 |
| auto_deny_after_hours | 72 |
| requires_evidence | `[test_report, security_scan, changelog]` |

Deny conditions:
- `defect_ledger.critical_count > 0` -- Active critical defects in the defect ledger
- `test_suite.pass_rate < 0.95` -- Test suite pass rate below 95%

Gate conditions:
- `ci_pipeline.all_stages_passed == true` -- All 7 CI pipeline stages must pass
- `security_scan.high_vulnerabilities == 0` -- No high/critical security findings
- `rollback_tested == true` -- Rollback tested in staging

### delete_prod_data

| Property | Value |
|----------|-------|
| action_id | `delete_prod_data` |
| risk_level | critical |
| required_tier | 3 |
| cooldown_minutes | 1440 (24 hours) |
| auto_deny_after_hours | 24 |
| requires_evidence | `[backup_verification, deletion_justification]` |

Deny conditions:
- `backup.verified == false` -- No verified backup exists

Gate conditions:
- `data_export.completed == true` -- Data export completed before deletion

### prod_rollback

| Property | Value |
|----------|-------|
| action_id | `prod_rollback` |
| risk_level | high |
| required_tier | 3 |
| cooldown_minutes | 30 |
| auto_deny_after_hours | 4 |
| requires_evidence | `[incident_report]` |

Deny conditions: None (emergency actions must not be blocked by conditions)

Gate conditions:
- `rollback_target.previously_deployed == true` -- Target version must have been previously deployed

### modify_governance

| Property | Value |
|----------|-------|
| action_id | `modify_governance` |
| risk_level | high |
| required_tier | 2 |
| cooldown_minutes | 0 |
| auto_deny_after_hours | 48 |
| requires_evidence | `[config_diff]` |

Gate conditions:
- `governance_diff.reviewed == true` -- Governance config diff reviewed by confirmer

---

## Timeout Behavior

| Scenario | Action Taken | Error Code | Logged As |
|----------|-------------|------------|-----------|
| Approval expires (no response within window) | Action denied automatically | GOV_APPROVAL_EXPIRED | `result: "expired"` |
| Approver unavailable | Escalate to next tier | GOV_TIER_INSUFFICIENT | `result: "gated"` |
| Single approver denies | Entire request denied | GOV_APPROVAL_DENIED | `result: "denied"` |
| Emergency override (P0 incident) | Release Judge can force-approve with audit note | -- | `result: "allowed", notes: "emergency_override"` |
| Cooldown active (retry too soon) | Action blocked | GOV_COOLDOWN_ACTIVE | `result: "denied"` |
| Evidence missing | Action blocked before approval flow starts | GOV_EVIDENCE_MISSING | `result: "gated"` |

### Timeout Values by Tier

| Tier | Default Timeout | Max Extension (via Defer) |
|------|----------------|--------------------------|
| 0 | N/A (immediate) | N/A |
| 1 | 5 - 10 min (action-dependent) | 15 min |
| 2 | 15 min | 22.5 min (1.5x) |
| 3 | 30 - 60 min (action-dependent) | 90 min (1.5x) |

### Emergency Override Protocol

For P0 incidents during production operation:

1. A single operator can initiate rollback with `emergency: true` flag.
2. This bypasses Tier 3 approval but the action is logged with `emergency_override: true`.
3. Post-hoc audit is required within 24 hours.
4. The post-hoc audit requires Tier 3 sign-off (Owner + Confirmer + Release Judge).
5. Failure to complete post-hoc audit within 24 hours triggers `GOV_ACTION_BLOCKED` on subsequent releases.

---

## Audit Requirements

Every approval or denial produces an `AuditRecord` persisted to `data/governance/audit/YYYY-MM-DD.jsonl`.

### Mandatory Audit Fields

| Field | Type | Description |
|-------|------|-------------|
| record_id | UUID v4 | Unique audit record identifier |
| timestamp | ISO-8601 | When the decision was made |
| actor | string | User or agent ID who performed the action |
| actor_roles | string[] | Roles the actor held at decision time |
| action | string | action_id or free-form action description |
| action_type | string | Category: `release`, `config_change`, `data_delete`, `approval`, etc. |
| target | string | Resource ID, path, or name acted upon |
| result | enum | `allowed`, `denied`, `gated`, `expired`, `error` |
| tier_used | number | Which tier was invoked (0-3) |
| tier_required | number | Minimum tier for this action |
| risk_level | string | `low`, `medium`, `high`, `critical` |
| risk_score | number | Computed risk score (0-100) |
| approvers | AuditApprover[] | Each approver's decision and timestamp |
| approval_request_id | string or null | Link to `ApprovalRequest` if applicable |
| evidence_paths | string[] | Paths to submitted evidence artifacts |
| notes | string | Freeform context from requester or denier |
| ip_address | string or null | Source IP if available |
| session_id | string | Links to broader session |
| duration_ms | number | How long the action took to execute |

### Audit Storage

- Path: `data/governance/audit/YYYY-MM-DD.jsonl`
- Retention: 365 days, then archived to cold storage
- Tamper protection: Each day's file has an appended SHA-256 checksum line. Checksums are also written to `data/governance/audit/checksums.jsonl`.
- Queryable by: actor, action, result, tier, date range, risk_level

---

## Denied Action Handling

### Immediate Effects

1. Denial is logged with mandatory reason (notes field required on deny).
2. Operator is notified via VS Code notification and governance panel update.
3. The denying approver's `comment` is surfaced in the UI.

### Cooldown Period

- Cannot retry the same action (same `action_id` + `target`) within the cooldown period.
- Default cooldown: 5 minutes for Tier 1, 15 minutes for Tier 2, 30 minutes for Tier 3.
- Configurable per action in `dangerous_actions[].cooldown_minutes`.
- Attempting retry during cooldown returns `GOV_COOLDOWN_ACTIVE`.

### Escalation on Repeated Denial

| Denial Count | Action |
|-------------|--------|
| 1st denial | Standard denial flow, cooldown applied |
| 2nd denial (same action + target) | Warning logged, operator receives escalation notice |
| 3rd denial (same action + target) | Escalate to Defect Tribunal |

### Tribunal Escalation

When 3 denials occur on the same action:

1. Defect Tribunal is convened (see `01_MASTER/DEFECT_TRIBUNAL_SYSTEM.md`).
2. Tribunal members: Program Director, subsystem owner, subsystem challenger, Evidence Steward.
3. If severity is critical, Release Judge is added.
4. Possible outcomes:
   - **Reopen phase** -- the underlying issue must be fixed before retry.
   - **Accept with conditions** -- action may proceed if conditions are met.
   - **Accept with waiver** -- action proceeds with documented exception.
   - **Reject as incomplete** -- action is permanently blocked for this target.

### Tribunal Timeline

| Severity | Tribunal convened within |
|----------|-------------------------|
| Critical | 24 hours of 3rd denial |
| High | 48 hours of 3rd denial |
| Medium | Next scheduled review cycle |
| Low | Batched with phase completion review |

---

## Error Code Reference

All error codes referenced in this document, sourced from subsystem specs.

### Governance Errors

| Code | Scope | Description | Recovery |
|------|-------|-------------|----------|
| GOV_APPROVAL_DENIED | Governance | One or more required approvers denied the request | Address concerns, resubmit with changes |
| GOV_TIER_INSUFFICIENT | Governance | Actor's tier is below the required tier for the action | Escalate to actor with sufficient tier |
| GOV_ACTION_BLOCKED | Governance | A deny_condition evaluated to true | Fix blocking condition (e.g., close critical defects) |
| GOV_APPROVAL_EXPIRED | Governance | Approval request timed out | Resubmit approval request |
| GOV_COOLDOWN_ACTIVE | Governance | Action attempted before cooldown period elapsed | Wait for cooldown or request emergency override |
| GOV_EVIDENCE_MISSING | Governance | Required evidence artifacts not attached | Attach required evidence and resubmit |
| GOV_ROLLBACK_FAILED | Release | Rollback procedure failed | Manual intervention, escalate to Tier 3 |

### Release Errors

| Code | Scope | Description | Recovery |
|------|-------|-------------|----------|
| REL_BUILD_FAILED | Release | CI/CD build stage failed | Fix build errors, re-trigger pipeline |
| REL_TEST_FAILED | Release | Test pass rate below threshold | Fix failing tests, re-trigger pipeline |
| REL_GATE_BLOCKED | Release | Release gate condition not met | Satisfy gate condition, re-check |
| REL_VERSION_CONFLICT | Release | Version not properly incremented | Correct version in package.json |
| REL_ARTIFACT_CORRUPT | Release | Package checksum verification failed | Re-run package stage |
| REL_MONITOR_ALERT | Release | Post-release monitoring anomaly | Investigate, consider rollback |

### ZeroClaw Errors

| Code | Scope | Description | Recovery |
|------|-------|-------------|----------|
| ZC_APPROVAL_DENIED | Hermes | A required signer denied, or approval timed out | Address signer concerns, resubmit |
| ZC_APPROVAL_TIMEOUT | Hermes | Approval chain not completed within window | Resubmit with fresh approval request |
| ZC_POLICY_VIOLATION | Hermes | Task attempted action outside its policy | Review and correct policy constraints |
| ZC_ROLLBACK_FAILED | ZeroClaw | Could not restore to snapshot state | Manual intervention, preserve snapshot |

### Memory Errors

| Code | Scope | Description | Recovery |
|------|-------|-------------|----------|
| MEM_SCOPE_DENIED | Memory | Agent lacks permission for requested scope | Check permission matrix, request elevation |
| MEM_AUTH_EXPIRED | Memory | Shiba auth token expired and refresh failed | Rotate SHIBA_AUTH_TOKEN |

### Routing Errors

| Code | Scope | Description | Recovery |
|------|-------|-------------|----------|
| ROUTE_WRONG_ROLE | Routing | Task sent to provider lacking capability | Check role matrix config |
| ROUTE_AUTH_FAILED | Routing | Provider rejected auth credentials | Check authRef env var, rotate key |

### Training Errors

| Code | Scope | Description | Recovery |
|------|-------|-------------|----------|
| TRAIN_CHECKPOINT_CORRUPTED | Training | Checkpoint checksum mismatch on resume | Delete checkpoint, resume from earlier |
| TRAIN_REMOTE_AUTH_FAILED | Training | Remote GPU provider rejected API key | Check env var, rotate key |

---

## Cross-Reference: Triad Rule

No subsystem passes on owner sign-off alone. For every action at Tier 2 or above:

1. **Owner** marks ready and initiates the action.
2. **Confirmer** verifies evidence and co-signs.
3. **Challenger** (Tier 3 only) attempts to break the critical path.
4. **Release Judge** (Tier 3 only) provides final pass/fail authority.

If owner and challenger disagree, a Defect Tribunal is convened per the escalation rules above.

---

## Config Reference

### Primary Config

```yaml
# config/governance.yaml
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

### Data Paths

| Path | Purpose |
|------|---------|
| `data/governance/audit/YYYY-MM-DD.jsonl` | Daily audit trail |
| `data/governance/audit/checksums.jsonl` | Daily checksum log (tamper protection) |
| `data/governance/approvals/` | Active and historical approval requests |
| `config/governance.yaml` | Tier definitions, dangerous actions, checklist |
| `config/governance.local.yaml` | Local overrides (gitignored) |

---

## Acceptance Criteria

1. Every action in the matrix (items 1-104) maps to exactly one required tier with no ambiguity.
2. A Tier 0 action executes without any user interaction and is logged in the audit trail.
3. A Tier 1 action shows a confirmation modal and blocks until the operator approves or denies.
4. A Tier 2 action requires both owner and confirmer approval before execution proceeds.
5. A Tier 3 action requires owner, confirmer, and release judge approval; challenger review for release actions.
6. A denied action is logged with the denier's comment, and the operator is notified.
7. An expired approval transitions to `GOV_APPROVAL_EXPIRED` automatically at the timeout boundary.
8. The 3-denial escalation triggers a Defect Tribunal per the tribunal system spec.
9. Emergency override bypasses Tier 3 with `emergency: true` flag and requires post-hoc audit within 24 hours.
10. All 104 actions have a corresponding error code for denial scenarios.
11. `deny_conditions` from the Dangerous Action Registry block execution with `GOV_ACTION_BLOCKED` regardless of approvals obtained.
12. The approval modal displays all required fields (action, risk score, resources, rollback status, approver list, timer, evidence).
