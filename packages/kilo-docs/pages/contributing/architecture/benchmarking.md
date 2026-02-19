---
title: "Benchmarking"
description: "Design for benchmarking Kilo Code against models and other agents"
---

# Benchmarking

## Summary

This document proposes a benchmarking system for Kilo Code with two primary goals:

1. **Compare models against one another** using the same agent -- measuring task completion, token cost, and total time
2. **Compare agents against one another** using the same model -- e.g., Kilo Code vs Claude Code, or Kilo Code v1.0 vs v1.1

The design leverages existing open source infrastructure rather than building a custom harness:

- **[Harbor](https://harborframework.com)** as the evaluation framework, with **[Terminal-Bench](https://tbench.ai)** and other datasets for task definitions
- **[ATIF](https://harborframework.com/docs/agents/trajectory-format)** (Agent Trajectory Interchange Format) for structured, per-step trace logging
- **[Opik](https://www.comet.com/docs/opik)** for trace ingestion, step-level LLM judge evaluation, and root cause analysis

The key engineering deliverable is a **Kilo Code Harbor adapter** that runs Kilo CLI autonomously in containerized environments and emits ATIF-compliant trajectories.

{% callout type="info" %}
This is separate from [production observability](/docs/contributing/architecture/agent-observability), which monitors real user sessions via PostHog. Benchmarking is an offline evaluation system for comparing quality, cost, and performance across models and agents.
{% /callout %}

## Problem Statement

As Kilo Code evolves, we need systematic answers to questions like:

- Did our latest release make the agent better or worse?
- Which model gives the best results for our users at a given price point?
- How does Kilo Code compare to Claude Code, Codex, or other agents on the same tasks?
- When a benchmark score drops, what specific step or decision caused the regression?

Today we have no structured way to answer these questions. Manual testing is not reproducible, and our existing PostHog telemetry does not capture the turn-by-turn detail needed for easy comparative analysis.

## Goals

1. Run Kilo Code against standardized benchmark datasets in a reproducible, containerized environment
2. Compare model performance (same agent, different models) on task completion, token cost, and wall-clock time
3. Compare agent performance (same model, different agents or Kilo versions) on the same metrics
4. Capture detailed per-step traces for root cause analysis when results differ
5. Make it easy to create custom task sets for targeted evaluation or marketing purposes

**Non-goals:**

- Production monitoring (covered by [Agent Observability](/docs/contributing/architecture/agent-observability))
- Automated remediation based on benchmark results

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Harbor Framework                       │
│                                                         │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │Terminal-Bench│  │  SWE-bench  │  │  Custom Tasks   │ │
│  │    2.0       │  │             │  │ (Kilo-specific) │ │
│  └──────┬───────┘  └──────┬──────┘  └───────┬─────────┘ │
│         └────────────────┼─────────────────┘            │
│                          ▼                              │
│              ┌───────────────────────┐                  │
│              │   Containerized Trial │                  │
│              │                       │                  │
│              │  ┌─────────────────┐  │                  │
│              │  │  Agent Under    │  │                  │
│              │  │  Test           │  │                  │
│              │  │  (kilo --auto)  │  │                  │
│              │  └────────┬────────┘  │                  │
│              │           │           │                  │
│              │           ▼           │                  │
│              │  ┌─────────────────┐  │                  │
│              │  │  Model API      │  │                  │
│              │  │  (Opus, GPT-5,  │  │                  │
│              │  │   Gemini, etc.) │  │                  │
│              │  └─────────────────┘  │                  │
│              └───────────┬───────────┘                  │
│                          │                              │
│                          ▼                              │
│              ┌───────────────────────┐                  │
│              │  ATIF Trajectory      │                  │
│              │  (per-step traces)    │                  │
│              └───────────┬───────────┘                  │
└──────────────────────────┼──────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌──────────────────────┐  ┌──────────────────────────┐
│  tbench.ai Dashboard │  │  Opik                    │
│  - Leaderboard       │  │  - Step-level traces     │
│  - Task pass/fail    │  │  - LLM judge per step    │
│  - Asciinema replay  │  │  - Cost attribution      │
│  - Aggregate scores  │  │  - Root cause comparison │
└──────────────────────┘  └──────────────────────────┘
```

## Components

### Harbor Framework

[Harbor](https://harborframework.com) is the evaluation framework built by the Terminal-Bench team. It provides:

- **Containerized environments** for reproducible task execution
- **Pre-integrated agents**: Claude Code, Codex, Gemini CLI, OpenHands, Terminus-2
- **A registry of benchmark datasets**: Terminal-Bench, SWE-bench, LiveCodeBench, and more
- **Cloud scaling** via Daytona, Modal, and E2B for running trials in parallel
- **Automatic ATIF trajectory generation** for all integrated agents

Harbor is the standard evaluation framework used by many frontier labs. Rather than building our own harness, we write a Kilo Code adapter and plug into the existing ecosystem.

### ATIF (Agent Trajectory Interchange Format)

[ATIF](https://harborframework.com/docs/agents/trajectory-format) is a standardized JSON format for logging the complete interaction history of an agent run. Each trajectory captures:

- **Every step**: User messages, agent responses, tool calls, observations
- **Per-step metrics**: Token counts (prompt, completion, cached), cost in USD, latency
- **Tool call detail**: Function name, arguments, and observation results
- **Reasoning content**: The agent's internal reasoning at each step (when available)
- **Aggregate metrics**: Total tokens, total cost, total steps

This granularity is what enables step-level comparison between runs -- not just "did it pass or fail" but "at step 7, Agent A chose tool X while Agent B chose tool Y."

### Opik

[Opik](https://www.comet.com/docs/opik) (by Comet) provides trace ingestion and analysis with a first-class Harbor integration. Running benchmarks through Opik is as simple as:

```bash
opik harbor run -d terminal-bench@head -a kilo -m anthropic/claude-opus-4
```

Opik adds value beyond what the tbench.ai dashboard provides:

| Capability                    | tbench.ai Dashboard | Opik |
| ----------------------------- | ------------------- | ---- |
| Task-level pass/fail          | Yes                 | Yes  |
| Aggregate leaderboard         | Yes                 | No   |
| Asciinema replay              | Yes                 | No   |
| Step-level trace view         | No                  | Yes  |
| Step-level LLM judge          | No                  | Yes  |
| Cost attribution per step     | No                  | Yes  |
| Side-by-side trace comparison | No                  | Yes  |
| Root cause analysis           | No                  | Yes  |

The two dashboards are complementary: tbench.ai for high-level leaderboard comparisons, Opik for drilling into why a specific run succeeded or failed.

### Datasets

Harbor's registry provides access to established benchmark datasets. The choice of dataset can vary depending on what you are evaluating:

| Dataset            | Focus                            | Use Case                                           |
| ------------------ | -------------------------------- | -------------------------------------------------- |
| Terminal-Bench 2.0 | CLI/terminal tasks (89 tasks)    | General agent capability on hard, realistic tasks  |
| SWE-bench          | Real GitHub issues in real repos | Software engineering task completion               |
| LiveCodeBench      | Competitive programming problems | Code generation quality                            |
| Custom task sets   | Whatever you define              | Targeted evaluation, marketing, regression testing |

#### Creating Custom Task Sets

Creating a custom Harbor task set is straightforward. Each task consists of:

1. **A Dockerfile** defining the environment (OS, installed packages, repo state)
2. **A task description** (the prompt given to the agent)
3. **A verification script** (tests that determine pass/fail)
4. **Optionally, a reference solution**

This makes it easy to create task sets that target specific Kilo Code capabilities -- for example, a set of refactoring tasks, or a set of multi-file debugging scenarios. Custom sets can be published to the Harbor registry or kept private.

See the [Harbor task tutorial](https://www.tbench.ai/docs/task-tutorial) for a step-by-step guide.

## Deliverables

### 1. Kilo Code Harbor Adapter

The primary engineering deliverable. This adapter:

- **Installs Kilo CLI** in a Docker container
- **Configures autonomous execution** using `kilo run --auto`, which disables all permission prompts so the agent runs fully unattended
- **Translates Harbor task prompts** into Kilo CLI invocations
- **Emits ATIF-compliant trajectories** capturing every step, tool call, and metric

The adapter follows the same pattern as existing Harbor agents (see the [OpenHands adapter](https://harborframework.com/docs/agents/trajectory-format#openhands-example) for reference). The key implementation detail is the `populate_context_post_run` method that converts Kilo's execution log into ATIF format.

**Autonomous execution is critical.** Harbor runs containerized trials in parallel and expects agents to execute from start to finish without human intervention. The adapter must ensure:

- No interactive prompts for API keys (injected via environment variables)
- No permission dialogs for file writes, command execution, etc.
- Graceful timeout handling if the agent gets stuck

### 2. Custom Task Set Template

Documentation and examples for creating Kilo-specific task sets:

- Template Dockerfile and verification script
- Guidelines for writing good task descriptions
- Examples of tasks that highlight coding agent capabilities
- Instructions for publishing to Harbor's registry or running privately

This enables the team to create targeted benchmarks for marketing, regression testing, or capability evaluation.

### 3. Opik Integration

Configure the Opik-Harbor integration for Kilo Code benchmark runs:

- Set up `opik harbor run` with the Kilo Code adapter
- Define standard LLM judge criteria for step-level evaluation:
    - **Tool choice correctness**: Did the agent use the right tool at each step?
    - **Reasoning quality**: Was the agent's reasoning at each step sound?
    - **Efficiency**: Were there unnecessary or redundant steps?
- Create saved views for common comparison scenarios (model-vs-model, version-vs-version)

### 4. CI Regression Detection

{% callout type="note" %}
Lower priority. Implement after the core benchmarking system is working.
{% /callout %}

Run a small subset of benchmark tasks (10-15) on release branches to catch regressions before shipping. Harbor supports this pattern natively. The subset should be chosen for:

- Fast execution (under 5 minutes per task)
- High signal (tasks that historically differentiate good and bad agent behavior)
- Stability (deterministic verification, not flaky)

## Example Workflows

### Comparing Models

Run the same Kilo Code agent against Terminal-Bench with different models:

```bash
# Run with Claude Opus
opik harbor run -d terminal-bench@2.0 -a kilo -m anthropic/claude-opus-4

# Run with GPT-5
opik harbor run -d terminal-bench@2.0 -a kilo -m openai/gpt-5

# Run with Gemini 3 Pro
opik harbor run -d terminal-bench@2.0 -a kilo -m google/gemini-3-pro
```

Compare results in tbench.ai for aggregate scores and in Opik for step-level analysis of where models diverge.

### Comparing Agents

Run different agents against the same dataset with the same model:

```bash
# Run Kilo Code
opik harbor run -d terminal-bench@2.0 -a kilo -m anthropic/claude-opus-4

# Run Claude Code
opik harbor run -d terminal-bench@2.0 -a claude-code -m anthropic/claude-opus-4
```

### Comparing Kilo Versions

Test a new release against the previous version:

```bash
# Run current release
opik harbor run -d terminal-bench@2.0 -a kilo@v2.0 -m anthropic/claude-opus-4

# Run candidate release
opik harbor run -d terminal-bench@2.0 -a kilo@v2.1-rc1 -m anthropic/claude-opus-4
```

Use Opik's trace comparison view to identify specific steps where the new version regressed or improved.

### Running a Custom Task Set

```bash
# Run against a custom Kilo-specific dataset
opik harbor run -d kilo-refactoring@1.0 -a kilo -m anthropic/claude-opus-4
```

## LLM Judge: Two Levels

Harbor provides task-level judging (did the agent solve the task?). Opik adds step-level evaluation:

| Level          | Tool   | What It Tells You                                                                                                                                  |
| -------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task-level** | Harbor | Pass/fail, score, total time, total cost                                                                                                           |
| **Step-level** | Opik   | At step N, the agent chose tool X when it should have used tool Y. The reasoning was flawed because of Z. This step cost $0.03 and took 4 seconds. |

Step-level evaluation is where root cause debugging happens. When a benchmark score drops between versions, you can trace back to the exact decision point that caused the regression.

## Relationship to Production Observability

This benchmarking system is complementary to, but separate from, the [Agent Observability](/docs/contributing/architecture/agent-observability) system:

| Concern         | Benchmarking                          | Production Observability              |
| --------------- | ------------------------------------- | ------------------------------------- |
| **Purpose**     | Offline evaluation of agent quality   | Real-time monitoring of user sessions |
| **Data source** | Controlled benchmark tasks            | Real user interactions                |
| **Tools**       | Harbor, Opik, tbench.ai               | PostHog, custom metrics               |
| **When**        | Before release, on-demand             | Continuously in production            |
| **Output**      | Leaderboard scores, trace comparisons | Alerts, dashboards, SLO tracking      |

## References

- [Harbor Framework Documentation](https://harborframework.com/docs)
- [Terminal-Bench 2.0 Paper](https://huggingface.co/papers/2601.11868)
- [ATIF Specification (RFC)](https://github.com/laude-institute/harbor/blob/main/docs/rfcs/0001-trajectory-format.md)
- [Opik Harbor Integration](https://www.comet.com/docs/opik/integrations/harbor)
- [tbench.ai Dashboard](https://www.tbench.ai/docs/dashboard)
- [Harbor Task Tutorial](https://www.tbench.ai/docs/task-tutorial)
