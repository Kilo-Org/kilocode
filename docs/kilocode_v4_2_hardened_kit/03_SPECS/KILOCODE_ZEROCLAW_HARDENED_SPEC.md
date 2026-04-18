# KiloCode ZeroClaw Hardened Spec

## Purpose
Allow KiloCode to request sandboxed execution through Hermes with explicit safety boundaries.

## Job request schema
```json
{
  "task_id": "string",
  "origin": "kilocode|bot|hermes",
  "project_path": "string",
  "risk_level": "low|medium|high",
  "requires_execution": true,
  "allowed_workspace_scope": ["string"],
  "network_policy": "deny|allowlist|open",
  "write_policy": "read_only|buffered|approved",
  "limits": {
    "timeout_sec": 600,
    "memory_mb": 4096,
    "cpu": 2
  }
}
```

## Job response schema
```json
{
  "job_id": "string",
  "status": "queued|running|completed|failed|blocked",
  "exit_code": 0,
  "logs_path": "string",
  "artifacts": ["string"],
  "changed_files": ["string"],
  "requires_approval": false
}
```

## Failure modes
- workspace out of scope
- network denied
- timeout
- approval missing
- command failure
- artifact return failure

## Evidence requirements
- request payload
- route trace
- execution log
- artifact list
- approval record for medium/high risk
