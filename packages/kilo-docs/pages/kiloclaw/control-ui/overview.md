---
title: "Control UI Overview"
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
- **Exec Approvals** — Edit gateway or node command allowlists. See [Exec Approvals](/docs/kiloclaw/control-ui/exec-approvals).
- **Config** — View and edit `openclaw.json` with schema-based form rendering and a raw JSON editor.
- **Logs** — Live tail of gateway logs with filtering and export.
- **Debug** — Status, health, model snapshots, event log, and manual RPC calls.
- **Update** — Run package updates and restart the gateway.

For more details, please see the official [OpenClaw documentation](https://docs.openclaw.ai/web/control-ui).

{% callout type="warning" %}
Do not use the **Update** feature in the Control UI to update KiloClaw. Use **Redeploy** from the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#redeploy) instead. Updating via the Control UI will not apply the correct KiloClaw platform image and may break your instance.
{% /callout %}

## Authentication

Auth is handled via token or password on the WebSocket handshake. Remote connections require one-time device pairing — the pairing request appears on the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#pairing-requests) or in the Control UI itself.
