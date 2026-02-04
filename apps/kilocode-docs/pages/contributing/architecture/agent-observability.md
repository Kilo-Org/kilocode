---
title: "Agent Observability"
description: "Observability and monitoring for agentic coding systems"
---

# Kilo Code - Agent Observability

## Problem Statement

Agentic coding systems like Kilo Code operate with significant autonomy, executing multi-step tasks that involve LLM inference, tool execution, file manipulation, and external API calls. These systems mix traditional systems observability (i.e. request/response) with agentic behavior (i.e. planning, reasoning, and tool use).

At the lower level, we can observe the system as a traditional API, but at the higher level, we need to observe the agent's behavior and the quality of its outputs.

Some examples of customer-facing error modes:

- Model API calls may be slow or fail due to rate limits, network issues, or model unavailability
- Model API calls may produce invalid JSON or malformed responses
- An agent may get stuck in a loop, repeatedly attempting the same failing operation
- Sessions may degrade gradually as context windows fill up
- The agent may complete a task technically but produce incorrect or unhelpful output
- Users may abandon sessions out of frustration without explicit error signals

All of these contribute to the overall reliability and user experience of the system.

## Goals

1. Detect and alert on acute incidents within minutes
2. Surface slow-burn degradations within hours
3. Facilitate root cause analysis when issues occur
4. Track quality and efficiency trends over time
5. Build a foundation for continuous improvement of the agent

**Non-goals for this proposal:**

- Automated remediation
- A/B testing infrastructure

## Proposed Approach

Focus on the lower-level systems observability first, then build up to higher-level agentic behavior observability.

## Phase 1: Systems Observability

**Objective:** Establish awareness and alerting for hard failures.

This phase focuses on systems metrics we can capture with minimal changes, providing immediate operational visibility.

### Phase 1a: LLM observability and alerting

#### Metrics to Capture

Capture these metrics per LLM API call:

- Provider
- Model
- Tool
- Latency
- Success / Failure
- Error type and message (if failed)
- Token counts
- Source (CLI/JetBrains/VSCode/etc)

#### Dashboards

Common dashboards which offer filtering based on provider, model, and tool:

- Error rate
- Latency
- Token usage

#### Alerting

Implement [multi-window, multi-burn-rate alerting](https://sre.google/workbook/alerting-on-slos/) against error budgets:

| Window | Burn Rate | Action | Use Case           |
| ------ | --------- | ------ | ------------------ |
| 5 min  | 14.4x     | Page   | Major Outage       |
| 30 min | 6x        | Page   | Incident           |
| 6 hr   | 1x        | Ticket | Change in behavior |

Paging should **only occur on Recommended Models when using the Kilo Gateway**. All other alerts should be tickets, and some may be configured to be ignored.

**Initial alert conditions:**

- LLM API error rate exceeds SLO (per tool/model/provider)
- Tool error rate exceeds SLO (per tool/model/provider)
- p50/p90 latency exceeds SLO (per tool/model/provider)

### Phase 1b: Session metrics

#### Metrics to Capture

**Per-session (aggregated at session close or timeout):**

- Session duration
- Time from user input to first model response
- Total turns/steps
- Total tool calls by tool type
- Total errors by error type
    - Agent stuck errors (repetitive tool calls, etc)
    - Tool call errors
- Total tokens consumed
- Context condensing frequency
- Termination reason (user closed, timeout, explicit completion, error)

#### Alerting

None.

## Phase 2: Agent Tool Usage

**Objective:** Detect how agents are using tools in a given session.

### Metrics to Capture

**Loop and repetition detection:**

- Count of identical tool calls within a session (same tool + same arguments)
- Count of identical failing tool calls (same tool + same arguments + same error)
- Detection of oscillation patterns (alternating between two states)

**Progress indicators:**

- Unique files touched per session
- Unique tools used per session
- Ratio of repeated to unique operations

### Alerting

None to start, we will learn.

## Phase 3: Session Outcome Tracking

**Objective:** Understand whether sessions are successful from the user's perspective.

Hard errors and behavior metrics tell us about failures, but we also need signal on overall session health.

### Metrics to Capture

**Explicit signals:**

- User feedback (thumbs up/down) rate and sentiment
- User abandonment patterns (session ends mid-task without completion signal)

**Implicit signals:**

May require LLM analysis of session transcripts to detect:

- Session termination classification (completed, abandoned, errored, timed out)
