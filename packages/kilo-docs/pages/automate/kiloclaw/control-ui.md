---
title: "OpenClaw Control UI"
description: "Browser-based dashboard for managing your OpenClaw instance"
---

# OpenClaw Control UI

The Control UI is a browser-based dashboard (built with Vite + Lit) served by the OpenClaw Gateway on the same port as the gateway itself (default: `http://localhost:18789/`). It connects via WebSocket and gives you real-time control over your agent, channels, sessions, and system configuration. For KiloClaw users, see [Accessing the Control UI](/docs/automate/kiloclaw/dashboard#accessing-the-control-ui) to get started.

## Features

- **Chat** — Send messages, stream responses with live tool-call output, view history, and abort runs.
- **Channels** — View the status of connected messaging platforms, scan QR codes for login, and edit per-channel config.
- **Sessions** — List active sessions with thinking and verbose overrides.
- **Cron Jobs** — Create, edit, enable/disable, run, and view history of scheduled tasks.
- **Skills** — View status, enable/disable, install, and manage API keys for skills.
- **Nodes** — List paired devices and their capabilities.
- **Exec Approvals** — Edit gateway or node command allowlists. See [Exec Approvals](#exec-approvals) below.
- **Config** — View and edit `openclaw.json` with schema-based form rendering and a raw JSON editor.
- **Logs** — Live tail of gateway logs with filtering and export.
- **Debug** — Status, health, model snapshots, event log, and manual RPC calls.
- **Update** — Run package updates and restart the gateway.

For more details, please see the official [OpenClaw documentation](https://docs.openclaw.ai/web/control-ui).

{% callout type="warning" %}
Do not use the **Update** feature in the Control UI to update KiloClaw. Use **Redeploy** from the [KiloClaw Dashboard](/docs/automate/kiloclaw/dashboard#redeploy) instead. Updating via the Control UI will not apply the correct KiloClaw platform image and may break your instance.
{% /callout %}

## Authentication

Auth is handled via token or password on the WebSocket handshake. We use the one time "access code" from your KiloClaw Dashboard to pair your device. Other remote connections require one-time device pairing — the pairing request appears on the [KiloClaw Dashboard](/docs/automate/kiloclaw/dashboard#pairing-requests) or in the Control UI itself.

## Exec Approvals

Exec approvals are the safety interlock that controls which commands your agent can run on the host machine (gateway or node). By default, **all host exec requests are denied** — you must explicitly allowlist the commands you want your agent to run independently. This prevents accidental execution of destructive commands.

{% callout type="warning" %}
The default security policy is `deny`. You must configure an allowlist before your agent can execute any host commands.
{% /callout %}

### How It Works

Approvals are enforced locally on the execution host and sit on top of tool policy and elevated gating. The effective policy is always the **stricter** of `tools.exec.*` and the approvals defaults. Settings are stored in `~/.openclaw/exec-approvals.json` on the host.

### Security Policies

| Policy      | Behavior                                       |
| ----------- | ---------------------------------------------- |
| `deny`      | Block all host exec requests (default)         |
| `allowlist` | Allow only commands matching the allowlist     |
| `full`      | Allow everything (equivalent to elevated mode) |

### Ask Behavior

The `ask` setting controls when the user is prompted for approval:

| Setting   | Behavior                                                |
| --------- | ------------------------------------------------------- |
| `off`     | Never prompt                                            |
| `on-miss` | Prompt only when the allowlist does not match (default) |
| `always`  | Prompt on every command                                 |

If a prompt is required but no UI is reachable, the `askFallback` setting decides the outcome (`deny` by default).

### Allowlists

Allowlists are **per agent** — each agent has its own set of allowed command patterns. Patterns are case-insensitive globs that must resolve to binary paths (basename-only entries are ignored).

Example patterns:

```
~/Projects/**/bin/rg
~/.local/bin/*
/opt/homebrew/bin/rg
```

Each entry tracks last-used metadata (timestamp, command, resolved path) so you can audit and keep the list tidy.

### Approval Flow

When a command requires approval, the gateway broadcasts the request to connected operator clients. The approval dialog shows the command, arguments, working directory, agent ID, and resolved path. You can:

- **Allow once** — run the command now
- **Allow always** — add to the allowlist and run
- **Deny** — block the request

Approval prompts can also be forwarded to chat channels (Slack, Telegram, Discord, etc.) and resolved with `/approve`.

### Editing in the Control UI

Navigate to **Nodes > Exec Approvals** in the Control UI to edit defaults, per-agent overrides, and allowlists. Select a scope (Defaults or a specific agent), adjust the policy, add or remove allowlist patterns, then save.

{% callout type="info" %}
If a node does not yet advertise exec approval capabilities, edit its `~/.openclaw/exec-approvals.json` file directly. You can also use the CLI: `openclaw approvals`.
{% /callout %}

## Related

- [KiloClaw Dashboard](/docs/automate/kiloclaw/dashboard)
- [KiloClaw Overview](/docs/automate/kiloclaw/overview)
- [Connecting Chat Platforms](/docs/automate/kiloclaw/chat-platforms)
