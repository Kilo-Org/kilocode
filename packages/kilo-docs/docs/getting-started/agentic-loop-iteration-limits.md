# Configuring Agentic Loop Iteration Limits

This document describes the mechanisms available to limit agentic loop iterations (steps) per request in Kilo CLI.

## Overview

By default, the Kilo CLI agentic loop has **no hard iteration limit**. It runs until:

- The model decides to stop (finish reason is not `tool-calls`)
- The user cancels/aborts the request
- A permission is denied (e.g., doom loop detection)
- A non-retryable error occurs

There are several configurable mechanisms to control iteration behavior.

## Per-Agent `steps` Limit

The primary mechanism to cap agentic iterations is the `steps` configuration field, set per agent in your project or global config file (`kilo.json` or `opencode.json`).

### Configuration

```json
{
  "agent": {
    "code": {
      "steps": 50
    },
    "plan": {
      "steps": 100
    }
  }
}
```

| Field      | Type             | Default               | Description                                                              |
| ---------- | ---------------- | --------------------- | ------------------------------------------------------------------------ |
| `steps`    | positive integer | `Infinity` (no limit) | Maximum number of agentic iterations before forcing a text-only response |
| `maxSteps` | positive integer | N/A                   | **Deprecated.** Alias for `steps`. Use `steps` instead.                  |

### Behavior

When the step counter reaches the configured `steps` value, the agent is instructed (via prompt injection) that tools are disabled and it must respond with text only. This is a **soft limit** — it relies on the model obeying the instruction rather than forcibly terminating the loop. In practice, the model responds with a text summary, which causes the loop to exit naturally.

**Source:** `packages/opencode/src/session/prompt.ts` (lines 603-604, 713-720)

## Doom Loop Detection

A hardcoded guard detects when the agent makes **3 consecutive identical tool calls** (same tool name and same input). When triggered, it raises a `doom_loop` permission check.

### Configuration

The threshold (3) is hardcoded and not user-configurable. However, the **permission action** for `doom_loop` is configurable per agent:

```json
{
  "agent": {
    "code": {
      "permission": {
        "doom_loop": "deny"
      }
    }
  }
}
```

| Value             | Behavior                                        |
| ----------------- | ----------------------------------------------- |
| `"ask"` (default) | Prompts the user for approval before continuing |
| `"allow"`         | Silently allows the loop to continue            |
| `"deny"`          | Blocks the tool call and stops the loop         |

**Source:** `packages/opencode/src/session/processor.ts` (line 21, lines 154-178)

## `--auto` CLI Flag

When using `kilo run --auto`, all permission requests (including doom loop detection) are automatically approved. This means the agent can run indefinitely if no `steps` limit is configured.

```bash
kilo run --auto "implement feature X"
```

**Recommendation:** When using `--auto` for autonomous or pipeline usage, always set a `steps` limit to prevent runaway iterations.

**Source:** `packages/opencode/src/cli/cmd/run.ts` (lines 307-311)

## `continue_loop_on_deny` Experimental Setting

By default, when a tool call is denied by permissions, the agentic loop stops. This experimental setting changes that behavior:

```json
{
  "experimental": {
    "continue_loop_on_deny": true
  }
}
```

When enabled, the loop continues even after a tool call is denied, allowing the agent to try alternative approaches. When disabled (default), a denied permission stops the loop immediately.

**Source:** `packages/opencode/src/config/config.ts` (line 1283), `packages/opencode/src/session/processor.ts` (line 50)

## Context Window Compaction

When the context window approaches its limit, automatic compaction is triggered to summarize older messages and free space. This is an indirect limit — it prevents context overflow but allows the loop to continue.

```json
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 8000
  }
}
```

**Source:** `packages/opencode/src/session/prompt.ts` (lines 586-598)

## Output Token Limit

The per-call output token limit can be configured via environment variable. This limits tokens per LLM call, not per loop iteration:

```bash
export KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX=16000
```

Default: `32000` tokens.

**Source:** `packages/opencode/src/provider/transform.ts` (line 21)

## Summary of All Controls

| Mechanism               | Scope                  | Default               | Configurable?          | Hard/Soft Limit                   |
| ----------------------- | ---------------------- | --------------------- | ---------------------- | --------------------------------- |
| `steps` per agent       | Per agent, per request | No limit (`Infinity`) | Yes — config file      | Soft (prompt injection)           |
| Doom loop detection     | Per assistant message  | 3 identical calls     | Permission action only | Soft (permission check)           |
| `--auto` flag           | Per CLI invocation     | `false`               | Yes — CLI flag         | N/A (removes permission gates)    |
| `continue_loop_on_deny` | Global                 | `false`               | Yes — config file      | Controls loop termination on deny |
| Context compaction      | Per session            | Auto-enabled          | Yes — config file      | Indirect (prevents overflow)      |
| Output token max        | Per LLM call           | 32,000                | Yes — env var          | Hard (per call, not per loop)     |
| User abort/cancel       | Manual                 | N/A                   | User action            | Hard                              |

## Recommended Configuration for Autonomous Usage

For CI/CD pipelines or autonomous usage with `kilo run --auto`, set explicit step limits:

```json
{
  "agent": {
    "code": {
      "steps": 100,
      "permission": {
        "doom_loop": "deny"
      }
    }
  }
}
```

This ensures the agent will not run indefinitely, even with all permissions auto-approved.
