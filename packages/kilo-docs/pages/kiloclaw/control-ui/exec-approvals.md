---
title: "Exec Approvals"
description: "Control which commands your KiloClaw agent can run on the host machine"
---

# Exec Approvals

Exec approvals are the safety interlock that controls which commands your agent can run on the host machine (gateway or node). By default, **all host exec requests are denied** — you must explicitly allowlist the commands you want your agent to run independently. This prevents accidental execution of destructive commands.

{% callout type="warning" %}
The default security policy is `deny`. You must configure an allowlist before your agent can execute any host commands.
{% /callout %}

## How It Works

Approvals are enforced locally on the execution host and sit on top of tool policy and elevated gating. The effective policy is always the **stricter** of `tools.exec.*` and the approvals defaults. Settings are stored in `~/.openclaw/exec-approvals.json` on the host.

## Security Policies

| Policy      | Behavior                                       |
| ----------- | ---------------------------------------------- |
| `deny`      | Block all host exec requests (default)         |
| `allowlist` | Allow only commands matching the allowlist     |
| `full`      | Allow everything (equivalent to elevated mode) |

## Ask Behavior

The `ask` setting controls when the user is prompted for approval:

| Setting   | Behavior                                                |
| --------- | ------------------------------------------------------- |
| `off`     | Never prompt                                            |
| `on-miss` | Prompt only when the allowlist does not match (default) |
| `always`  | Prompt on every command                                 |

If a prompt is required but no UI is reachable, the `askFallback` setting decides the outcome (`deny` by default).

## Allowlists

Allowlists are **per agent** — each agent has its own set of allowed command patterns. Patterns are case-insensitive globs that must resolve to binary paths (basename-only entries are ignored).

Example patterns:

```
~/Projects/**/bin/rg
~/.local/bin/*
/opt/homebrew/bin/rg
```

Each entry tracks last-used metadata (timestamp, command, resolved path) so you can audit and keep the list tidy.

## Approval Flow

When a command requires approval, the gateway broadcasts the request to connected operator clients. The approval dialog shows the command, arguments, working directory, agent ID, and resolved path. You can:

- **Allow once** — run the command now
- **Allow always** — add to the allowlist and run
- **Deny** — block the request

Approval prompts can also be forwarded to chat channels (Slack, Telegram, Discord, etc.) and resolved with `/approve`.

## Editing in the Control UI

Navigate to **Nodes > Exec Approvals** in the Control UI to edit defaults, per-agent overrides, and allowlists. Select a scope (Defaults or a specific agent), adjust the policy, add or remove allowlist patterns, then save.
