---
title: "Recover with Kilo"
description: "How to use Recover with Kilo to fix KiloClaw instances"
---

# Recover with Kilo

## What is Recover with Kilo?

Recover with Kilo is a self-repair capability built into KiloClaw. When your instance has configuration issues, broken integrations, or other operational problems, you can launch a Kilo CLI Run — an AI-powered repair agent that diagnoses and fixes the issue directly on your KiloClaw machine, without needing to contact support.

Think of it as an automated sysadmin that runs inside your instance. You describe the problem in plain English, and the agent investigates, identifies the root cause, and applies fixes.

## When to Use It

Use Recover with Kilo when your KiloClaw instance is behaving unexpectedly, for example:

- A channel (Slack, Discord, Telegram) stopped working
- Gateway connections failing or timing out
- Model provider errors or configuration issues
- Missing or corrupted OpenClaw config
- Environment variables not propagating correctly
- Integration setup problems (GitHub, Linear, etc.)
- The instance is running but something isn't working as expected

## Prerequisites

| Requirement | Details |
|---|---|
| KiloClaw instance | Must be provisioned and have been deployed at least once (controller must include the CLI run routes) |
| Instance status | Must be running — the Fly Machine must be started |
| Feature flag | `KILOCLAW_KILO_CLI=true` must be set on the instance (enabled by default on new deploys) |
| API key | `KILO_API_KEY` must be configured on the instance (set during provisioning) |

If you see the error "Instance needs redeploy to support recovery", your instance was provisioned before this feature existed. You'll need to redeploy the instance to get the latest controller that supports CLI runs.

## How It Works

When you trigger a CLI run, the system executes this flow:

1. You describe the problem
2. Web app calls tRPC router
3. KiloClaw Worker -> Instance DO
4. Fly Machine controller endpoint `POST /_kilo/cli-run/start`
5. Controller spawns: `kilo run --auto "<system prompt + your description>"`
6. Agent diagnoses + fixes the issue on the machine
7. Process exits -> status updated in DB

### The System Prompt

Your description is wrapped in a system prompt that gives the repair agent full context about the machine's architecture:

- Key file paths (OpenClaw config at `/root/.openclaw/openclaw.json`, MCP servers, workspace, CLI config)
- Controller and gateway health endpoints
- Diagnostic commands (`openclaw doctor`, `jq empty` for config validation, etc.)
- Architecture details (controller on port 18789, gateway on 3001, loopback binding)
- Safety rules (don't expose secrets, preserve managed KiloClaw plugins, use SIGUSR1 for gateway restart)

## Using Recover with Kilo

### Starting a CLI Run

| Property | Value |
|---|---|
| Input | A description of the problem (1–10,000 characters) |
| Output | `{ ok: true, startedAt, id }` — the run has been initiated |

Example prompts:
- "My Telegram channel stopped receiving messages"
- "Gateway keeps crashing with exit code 1"
- "The GitHub integration is failing to authenticate"
- "Run openclaw doctor and fix any issues it finds"
- "Check if my MCP server config is valid"

### Monitoring Progress

While the run is in progress, you can poll for its status:

| Field | Description |
|---|---|
| `status` | `running`, `completed`, `failed`, or `cancelled` |
| `output` | Live stdout/stderr output from the agent (capped at ~1MB, newest first) |
| `exitCode` | Process exit code (0 = success) |
| `startedAt` | ISO timestamp when the run began |
| `completedAt` | ISO timestamp when the run finished |
| `prompt` | Your original problem description |

### Canceling a Run

If a run is taking too long or you want to stop it, you can cancel it. The process receives `SIGTERM`, then `SIGKILL` after 5 seconds if it hasn't exited.

## Error Responses

| Error Code | HTTP Status | Meaning |
|---|---|---|
| `kilo_cli_run_instance_not_running` | 409 | Instance is not in running status — start it first |
| `kilo_cli_run_already_active` | 409 | Another CLI run is already in progress — wait or cancel it first |
| `kilo_cli_run_no_active_run` | 409 | No active run to cancel |
| `controller_route_unavailable` | 404 | Controller is too old — redeploy the instance |
| Kilo CLI not enabled | 400 | `KILOCLAW_KILO_CLI` feature flag is not set |
| API key not configured | 400 | `KILO_API_KEY` is missing from the instance |

## Data Persistence

Each CLI run is recorded in the `kiloclaw_cli_runs` database table with:

| Column | Purpose |
|---|---|
| `id` | UUID primary key |
| `user_id` | Owner of the instance |
| `instance_id` | Which instance (null for legacy single-instance users) |
| `prompt` | Your problem description |
| `status` | `running`, `completed`, `failed`, `cancelled` |
| `started_at` | When the run started |
| `completed_at` | When the run finished |
| `exit_code` | Process exit code |
| `output` | Full captured output from the agent |
| `initiated_by_admin_id` | If an admin triggered the run (support troubleshooting) |

You can view your run history through the `listKiloCliRuns` endpoint, which returns up to 50 of your most recent runs.

### Admin Access

Support admins can also trigger CLI runs on behalf of users. These runs are recorded with `initiated_by_admin_id` set, so they appear in the history with `initiatedBy: 'admin'`. Admins have additional capabilities:

- `forceRetryRecovery` — manually trigger the Fly machine reconciliation recovery
- `cleanupRecoveryPreviousVolume` — delete a retained recovery volume after an instance restore

## Limitations

- **One run at a time**: Only one CLI run can be active per instance. Concurrent requests get a 409 conflict.
- **Output cap**: Agent output is capped at ~1MB. Older output is truncated from the front.
- **Instance must be running**: You cannot start a CLI run on a stopped, restoring, or destroyed instance.
- **Controller memory**: The controller only holds the active run in memory. If you poll for a completed run after a newer run has started, the original output is no longer available. The DB retains the last known state.
- **Lost outcomes**: If the controller reports no active run for a DB row still marked running, the run is recorded as failed with the output "[run state unavailable: controller no longer has an active CLI run for this record]". This doesn't necessarily mean the run failed — it means the outcome couldn't be captured before the controller moved on.
