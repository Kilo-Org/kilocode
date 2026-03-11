---
title: "OpenClaw Control UI"
description: "Browser-based dashboard for managing your OpenClaw instance"
---

# OpenClaw Control UI

The Control UI is a browser-based dashboard (built with Vite + Lit) served by the OpenClaw Gateway on the same port as the gateway itself (default: `http://localhost:18789/`). It connects via WebSocket and gives you real-time control over your agent, channels, sessions, and system configuration. For KiloClaw users, see [Accessing the Control UI](/docs/kiloclaw/dashboard#accessing-the-control-ui) to get started.

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
Do not use the **Update** feature in the Control UI to update KiloClaw. Use **Redeploy** from the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#redeploy) instead. Updating via the Control UI will not apply the correct KiloClaw platform image and may break your instance.
{% /callout %}

## Changing Models

The Control UI Chat tab doubles as a command line for model management. KiloClaw exposes 335+ models through the `kilocode` provider and you can browse and switch between them without leaving the chat.

| Command                              | Description                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `/model status`                      | View the currently active model and provider                                    |
| `/models kilocode`                   | Browse available models (paginated, 20 per page)                                |
| `/models kilocode <page>`            | Jump to a specific page (e.g. `/models kilocode 2`)                             |
| `/model kilocode/<provider>/<model>` | Switch to a specific model (e.g. `/model kilocode/anthropic/claude-sonnet-4.6`) |
| `/models kilocode all`               | List every available model at once                                              |

Each `/models` response includes helper text at the bottom with shortcuts for switching, paging, and listing all models.

To change the default model for all new sessions, edit `agents.defaults.model.primary` in your `openclaw.json` via **Config** in the Control UI (or the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#changing-the-model) for a quick dropdown pick).

For the full list of providers, advanced configuration, and CLI commands, see the [OpenClaw Model Providers documentation](https://docs.openclaw.ai/providers).

## Authentication

Auth is handled via token or password on the WebSocket handshake. Remote connections require one-time device pairing — the pairing request appears on the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#pairing-requests) or in the Control UI itself.

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

## Related

- [KiloClaw Dashboard](/docs/kiloclaw/dashboard)
- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Connecting Chat Platforms](/docs/kiloclaw/chat-platforms)
