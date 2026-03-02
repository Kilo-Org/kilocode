---
title: "Exec approvals"
description: "Controls which commands your agent is allowed to run"
---

# Exec approvals

Exec approvals are the safety interlock that controls which shell commands your agent can run on the host machine. By default, KiloClaw uses an **allowlist-only** policy — your agent cannot execute arbitrary commands unless you explicitly permit them.

This prevents accidental or unintended execution of destructive commands on your machine.

---

## Understand the default

Out of the box, the exec security policy is set to `allowlist`. No commands are permitted until you add patterns to the allowlist for that agent.

If the Control UI is unreachable when an approval is needed, requests fall back to `deny`.

---

## Change the policy

You can adjust the security policy, ask behavior, and per-agent allowlists from the **Nodes → Exec Approvals** card in the [OpenClaw Control UI](/docs/automate/kiloclaw/control-ui#exec-approvals).

The available security levels are:

| Policy      | Behavior                                             |
| ----------- | ---------------------------------------------------- |
| `allowlist` | Allow only explicitly allowlisted commands (default) |
| `deny`      | Block all host exec requests                         |
| `full`      | Allow everything — use with caution                  |

---

## Add allowlist exceptions

Allowlists are per-agent. In the Control UI, select the agent you want to edit, then add glob patterns that resolve to binary paths.

Some examples:

```
~/Projects/**/bin/rg
~/.local/bin/*
/opt/homebrew/bin/rg
```

Each entry tracks last-used metadata so you can audit and clean up entries over time.

---

## Approve commands on demand

When a command isn't on the allowlist, your agent can prompt for approval if the `ask` setting is `on-miss` (the default). The approval dialog shows the command, arguments, working directory, and resolved binary path.

You can **Allow once**, **Allow always** (adds to allowlist), or **Deny**.

Approval prompts can also be forwarded to chat channels like Slack, Telegram, or Discord and resolved with `/approve`.

---

## Related

- [OpenClaw Control UI](/docs/automate/kiloclaw/control-ui)
- [KiloClaw Dashboard](/docs/automate/kiloclaw/dashboard)
