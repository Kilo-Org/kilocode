# KiloCode Memory Hardened Spec

## Purpose
Make Shiba memory visible, explainable, and reviewable.

## Data model
### MemoryWrite
```yaml
project: string
scope: global|project|task
fact_type: contract|fix|recall|decision
summary: string
trace_ref: string
```

### MemoryRecallTrace
```yaml
query: string
project: string
results_count: integer
selected_entries: [string]
status: success|empty|failed
```

## Surfaces
- connectivity panel
- recall trace panel
- write history panel
- project scope filter

## Failure modes
- connection unavailable
- empty recall
- malformed write payload
- project mismatch

## Evidence requirements
- connectivity screenshot/log
- recall trace record
- write history entry
- cross-agent recall example
