---
title: "Triggers"
description: "Automate Kilo Cloud agents with webhooks and scheduled triggers"
---

# Triggers

Kilo's **Triggers** feature lets external events and recurring schedules drive your cloud agents automatically. Instead of manually initiating every task, triggers deliver prompts to your agent on your behalf — reacting to real-world events or running tasks on a schedule without any polling.

Triggers are managed from the [Triggers page](https://app.kilo.ai/cloud/triggers) in your Kilo Cloud dashboard.

## What Triggers Enable

- Automatic agent execution in response to external HTTP events
- Recurring scheduled tasks without manual intervention
- Consistent, reliable automation across your team's workflows
- Customizable prompt templates to control exactly what your agent does
- Pause, resume, and rotate trigger configuration at any time

## Trigger Types

| Type | Description |
|---|---|
| [**Webhooks**](#webhooks) | Receive HTTP POST requests from external services and deliver them as prompts to your agent |
| [**Scheduled**](#scheduled-triggers) | Run agent tasks on a recurring schedule using cron expressions |

## Prerequisites

Before enabling Triggers:

- **A Kilo Cloud account:** Sign in at [app.kilo.ai](https://app.kilo.ai).
- **Kilo Code credits:** The AI model uses credits when your agent processes a triggered prompt.

## Getting Started

1. Go to the [Triggers page](https://app.kilo.ai/cloud/triggers) in your Kilo Cloud dashboard.
2. Choose the type of trigger you want to create: **Webhook** or **Scheduled**.
3. Configure the trigger settings and prompt template.
4. Save and enable the trigger.

Once active, the trigger delivers a rendered prompt to your agent each time it fires.

## How Triggers Work

When a trigger fires:

1. The trigger receives the event (an inbound HTTP request, or a scheduled time firing).
2. Your **prompt template** is rendered — any template variables are substituted with event data.
3. The rendered message is delivered to your agent as a chat prompt.
4. Your agent processes and responds just as if you had typed the message yourself.

Each trigger type provides different template variables. See the sections below for details.

## Webhooks

Webhook triggers let external services kick off your agent automatically. Form submissions, alerts, calendar updates, ecommerce orders, CI/CD events, monitoring tools — anything that can send an HTTP POST request can trigger a conversation with your agent.

### Setting Up a Webhook

1. Go to the [Triggers page](https://app.kilo.ai/cloud/triggers).
2. Click **Set Up Webhook**.
3. Copy the generated webhook URL and configure it in your external service.

The webhook URL contains 128 bits of entropy and acts as its own credential. Treat it like a secret — do not commit it to public repositories or share it publicly.

### Webhook Prompt Template

The prompt template controls how the webhook payload is presented to your agent.

**Default template:**

```
You received a webhook event. Here is the payload:

{{bodyJson}}
```

**Available template variables:**

| Variable | Description |
|---|---|
| `{{body}}` | Raw request body |
| `{{bodyJson}}` | Pretty-printed JSON body |
| `{{method}}` | HTTP method (e.g., `POST`) |
| `{{headers}}` | Request headers |
| `{{path}}` | Request path |
| `{{query}}` | Query string parameters |
| `{{timestamp}}` | Time the webhook was received |

You can customize the template to give your agent more context. For example:

```
A GitHub push event just arrived. Summarize the changes and open a PR if any tests are affected.

Payload:
{{bodyJson}}
```

### Webhook Options

**Pause and Resume** — Toggle the **Active/Paused** switch to temporarily stop accepting webhooks without deleting the URL. Incoming requests are rejected while paused.

**Rotate URL** — If your webhook URL is compromised, click **Rotate URL** to invalidate the old URL and generate a new one. Update your integrations with the new URL afterward.

**Webhook Authentication (Optional)** — Require inbound requests to include a shared secret header:

1. Toggle **Webhook Authentication** to enabled.
2. Set the **Secret Header** name (default: `x-webhook-secret`).
3. Enter a **Shared Secret** value.
4. Click **Save**.

Requests missing the header or providing an incorrect secret are rejected.

{% callout type="note" title="Authentication is optional" %}
The webhook URL itself is already a strong credential (128-bit entropy). Authentication adds a second layer and is useful when your sending service supports webhook signing.
{% /callout %}

## Scheduled Triggers

Scheduled triggers fire at times you define using cron expressions, without waiting for an external event. Each trigger renders its prompt template and delivers it to your agent just like a webhook.

### Setting Up a Scheduled Trigger

1. Go to the [Triggers page](https://app.kilo.ai/cloud/triggers).
2. Click **Add Scheduled Trigger**.
3. Give your trigger a name.
4. Configure the schedule and prompt template.
5. Click **Save**.

### Configuring a Schedule

The schedule builder defaults to a friendly picker view. For more control, click **<> Advanced** to enter a raw cron expression.

**Simple mode** — Choose a frequency, time, and (optionally) days of the week from dropdown menus. The builder generates the cron expression for you and shows a preview of the next upcoming runs.

Available frequency options: every 10 minutes, every 15 minutes, every 30 minutes, hourly, daily, weekly.

**Advanced mode** — Enter a raw cron expression directly using the standard five-field format:

```
┌───────── minute (0-59)
│ ┌───────── hour (0-23)
│ │ ┌───────── day of month (1-31)
│ │ │ ┌───────── month (1-12)
│ │ │ │ ┌───────── day of week (0-7, where 0 and 7 are Sunday)
│ │ │ │ │
* * * * *
```

**Examples:**

| Expression | Meaning |
|---|---|
| `*/15 * * * *` | Every 15 minutes |
| `0 9 * * 1-5` | 9:00 AM on weekdays |
| `0 0 1 * *` | Midnight on the first of each month |
| `30 14 * * 3` | 2:30 PM every Wednesday |

{% callout type="note" title="Minimum interval" %}
The minimum interval between scheduled trigger runs is 10 minutes. Schedules more frequent than that are rejected.
{% /callout %}

**Timezone** — Select a timezone for your schedule. All fire times are calculated relative to the selected timezone, including automatic handling of daylight saving time transitions.

### Scheduled Trigger Prompt Template

**Default template:**

```
Run your scheduled task. Triggered at {{scheduledTime}}.
```

**Available template variables:**

| Variable | Description |
|---|---|
| `{{scheduledTime}}` | The time the schedule fired (ISO string) |
| `{{timestamp}}` | Capture timestamp (ISO string) |

{% callout type="note" title="Webhook variables are not available" %}
Since scheduled triggers do not receive an HTTP request, variables like `{{body}}`, `{{bodyJson}}`, `{{headers}}`, `{{method}}`, `{{path}}`, and `{{query}}` are not populated.
{% /callout %}

### Managing Scheduled Triggers

**Pause and Resume** — Toggle the **Active/Paused** switch to temporarily stop a trigger from firing. The configuration is preserved and can be resumed at any time.

**Edit** — Update the cron expression, timezone, and prompt template of an existing trigger at any time.

**Delete** — Remove a scheduled trigger from the Triggers page. A confirmation dialog is shown before deletion.

## Viewing Trigger Activity

All trigger invocations are logged in the Triggers page. You can inspect recent requests, response codes, timing, and rendered prompts. Scheduled trigger invocations include a **Scheduled** badge in the source column.

## Perfect For

Triggers are ideal for:

- **Teams automating repetitive workflows** such as daily standups, nightly reports, or deployment notifications
- **Integrating external services** like GitHub, Stripe, PagerDuty, or monitoring tools with your AI agent
- **Scheduled maintenance tasks** such as dependency checks, code quality scans, or database cleanups
- **Event-driven engineering workflows** that need an AI agent to respond immediately to CI/CD or production events

## Limitations and Guidance

{% callout type="warning" title="Triggers send prompts directly to your agent" %}
When a trigger fires, the rendered message is sent directly to your agent as a prompt. If your agent is configured with a permissive approval model, it will execute actions automatically without your explicit confirmation. Review your agent's permission settings and prompt templates carefully before enabling triggers.
{% /callout %}

- The minimum interval for scheduled triggers is **10 minutes**.
- Webhook URLs act as secrets — rotate them immediately if compromised.
- Prompt templates should be specific enough to prevent unintended agent actions.
- Kilo Code credits are consumed each time a trigger fires, and the agent processes the prompt.

## Related

- [Integrations](/docs/automate/integrations)
- [KiloClaw Triggers](/docs/kiloclaw/triggers)
