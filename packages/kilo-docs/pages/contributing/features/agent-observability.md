---
title: "Agent Observability"
description: "Current observability capabilities and roadmap for agentic coding systems"
---

# Agent Observability

{% callout type="info" title="Status" %}
Partial - API metrics, session ingestion, storage, and burn-rate alert infrastructure exist. Higher-order agent behavior and outcome analysis remain roadmap work.
{% /callout %}

## Overview

Agentic coding systems combine model requests, tool execution, file changes, and external API calls. Traditional request metrics catch hard failures. Agent behavior signals are also needed to investigate loops, degraded sessions, and poor outcomes.

Current cloud service context is documented in [Cloud Platform observability](/docs/contributing/architecture/cloud-platform#observability).

## Current implementation

| Capability | Status | Notes |
|---|---|---|
| API metrics ingestion | Current | Operational request metrics ingestion exists |
| Session metrics ingestion | Current | Session-level ingestion exists |
| Burn-rate alert evaluation | Current | Alert evaluation runs against stored metrics |
| Alert config storage | Current | Alert configuration storage exists |
| Analytics Engine storage | Current | API and session metrics datasets exist |
| Export pipelines | Current infrastructure | Metrics export infrastructure exists for downstream analysis |
| Per-message feedback | Current | Explicit user feedback signal exists |

## Roadmap

| Capability | Status | Goal |
|---|---|---|
| Oscillation detection | Planned or partial | Detect repeated or alternating agent actions |
| Unique-file progress metrics | Planned or partial | Track files touched during session |
| Unique-tool progress metrics | Planned or partial | Track tool diversity and repeated operations |
| Session termination classification | Planned | Distinguish completion, abandonment, timeout, and errors |
| Higher-order outcome analysis | Planned | Assess usefulness and task success beyond hard errors |

## Operational metrics roadmap

Use existing ingestion and alert infrastructure as base for dashboards and service-level objectives. Metric coverage should be validated before treating any field as available in production analysis.

### API metrics

Candidate dimensions for model requests:

- Provider
- Model
- Tool
- Latency
- Success or failure
- Error type
- Token counts
- Client source

### Session metrics

Candidate session aggregates:

- Session duration
- Time to first model response
- Turns and tool calls
- Errors by type
- Tokens consumed
- Context compaction frequency
- Termination reason

### Alert policy

Burn-rate evaluation infrastructure exists. Proposed alert routing should page only for recommended models using Kilo Gateway; other conditions can create tickets or remain disabled.

| Window | Burn rate | Proposed action |
|---|---|---|
| 5 min | 14.4x | Page for major outage |
| 30 min | 6x | Page for incident |
| 6 hr | 1x | Create ticket for behavior change |

## Agent behavior roadmap

Initial behavior analysis should focus on repeated operations and progress signals:

| Signal | Purpose |
|---|---|
| Identical tool calls | Detect repeated actions with same tool and arguments |
| Identical failing calls | Detect retries that repeat same failure |
| Oscillation patterns | Detect alternating states without progress |
| Unique files touched | Estimate breadth of session changes |
| Unique tools used | Compare progress against repeated operations |
| Repeated-to-unique ratio | Identify sessions that may be stuck |

## Outcome roadmap

Hard errors and behavior metrics do not prove user success. Later work can combine explicit per-message feedback with session termination analysis and other outcome signals. Offline model and agent comparison belongs in [Benchmarking](/docs/contributing/features/benchmarking).
