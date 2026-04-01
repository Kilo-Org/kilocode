---
title: "Triggers"
description: "Automate your KiloClaw agent with webhooks and scheduled triggers"
---

# Triggers

Triggers let external events and schedules drive your KiloClaw agent automatically. Instead of typing every instruction yourself, triggers deliver messages to your agent on your behalf. This lets it react to real-world events or run tasks on a schedule without polling.

All triggers are managed from the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard).

## Trigger Types

| Type | Description | Status |
| --- | --- | --- |
| [**Webhooks**](/docs/kiloclaw/triggers/webhooks) | Receive HTTP requests from external services (GitHub, Stripe, monitoring tools, etc.) and deliver them as chat messages to your agent | Available |
| **Time-based** | Run tasks on a schedule using cron expressions | Coming soon |

## How Triggers Work

1. An event occurs (an HTTP request arrives, or a schedule fires)
2. The trigger validates the request and renders the payload through a **prompt template**
3. The rendered message is delivered to your KiloClaw instance as a chat message
4. Your agent processes and responds like any other conversation

Prompt templates give you control over how payloads are presented to your agent. You can include instructions, context, and formatting alongside the raw event data.

## Related

- [Webhooks](/docs/kiloclaw/triggers/webhooks)
- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)
