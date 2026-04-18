# KiloCode Governance and Release Hardened Spec

## Purpose
Allow powerful operations without losing auditability or control.

## Data model
### ApprovalRecord
```yaml
action_id: string
actor: string
risk_level: medium|high
approved: true|false
timestamp: string
reason: string
```

## Controls
- authority tiers
- risk scoring
- approval gates
- dangerous action denylist
- audit history
- release verdict
- rollback visibility

## Failure modes
- missing approver
- bypass attempt
- stale approval
- release without rollback note

## Evidence requirements
- approval record
- deny record
- release verdict
- rollback checklist
