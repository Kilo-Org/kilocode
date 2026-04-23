---
title: "Triggers"
description: "Automate your KiloClaw agent with webhooks and scheduled triggers"
---

# Triggers

Triggers let external events and schedules drive your KiloClaw agent automatically. Instead of typing every instruction yourself, triggers deliver messages to your agent on your behalf. This lets it react to real-world events or run tasks on a schedule without polling.

All triggers are managed from the **Settings** page in the KiloClaw section of the sidebar.

## Trigger Types

| Type                                               | Description                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [**Webhooks**](/docs/kiloclaw/triggers/webhooks)   | Receive HTTP requests from external services (GitHub, Stripe, monitoring tools, etc.) and deliver them as chat messages to your agent |
| [**Scheduled**](/docs/kiloclaw/triggers/scheduled) | Run tasks on a recurring schedule (e.g. every 15 minutes, daily at 9 AM, weekdays only)                                               |

## How Triggers Work

1. A trigger fires
2. Your **prompt template** is rendered into a message
3. That message is delivered to your KiloClaw instance as a chat message
4. Your agent processes and responds like any other conversation

Each trigger type has its own set of template variables. See the [Webhooks](/docs/kiloclaw/triggers/webhooks) and [Scheduled](/docs/kiloclaw/triggers/scheduled) pages for details.

{% callout type="warning" title="Triggers send prompts directly to your agent" %}
When a trigger fires, the rendered message is sent directly to your KiloClaw agent as a prompt. If your instance is configured with a permission model that allows all actions, the agent will execute commands automatically without your explicit approval. This means triggers can cause your agent to take actions without you being aware. Review your instance's [permission settings](/docs/kiloclaw/control-ui/exec-approvals) and prompt templates carefully before enabling triggers.
{% /callout %}

## Related

- [Webhooks](/docs/kiloclaw/triggers/webhooks)
- [Scheduled Triggers](/docs/kiloclaw/triggers/scheduled)
- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)
