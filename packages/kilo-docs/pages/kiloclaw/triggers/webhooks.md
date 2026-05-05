---
title: "Webhooks"
description: "Trigger your KiloClaw agent from external events using webhooks"
---

# Webhooks

KiloClaw supports inbound webhooks so external events can trigger your agent automatically. Form submissions, alerts, calendar updates, ecommerce orders, IoT sensor data; anything that can send an HTTP request can kick off a conversation with your agent. When a webhook fires, the payload is rendered through a prompt template and delivered as a chat message to your KiloClaw instance. The agent processes and responds as if you typed it yourself.

## Setup

1. Go to **Settings** under the KiloClaw section in the sidebar
2. Find the **Webhook Integration** card and click **Manage**
3. Click **Set Up Webhook**

KiloClaw generates a unique webhook URL for your instance. Copy it and configure it as the destination in whatever service you want to receive events from (GitHub, Stripe, a monitoring tool, etc.).

{% callout type="warning" title="Treat the URL as a secret" %}
The webhook URL contains 128 bits of entropy and acts as its own credential (similar to Slack webhook URLs). Anyone with the URL can send messages to your instance. Do not commit it to public repositories or share it in public channels.
{% /callout %}

## How It Works

1. An external service sends an HTTP POST to your webhook URL
2. The webhook worker validates the request (and optionally checks authentication)
3. The payload is rendered through your **prompt template** (see below)
4. The rendered message is delivered to your KiloClaw instance as a chat message
5. Your agent receives and responds to the message like any other conversation

## Prompt Template

The prompt template controls how webhook payloads are presented to your agent. You can customize it from the **Webhook Integration** section in Settings.

**Default template:**

```
You received a webhook event. Here is the payload:

{{bodyJson}}
```

**Available variables:**

| Variable | Description |
|---|---|
| `{{body}}` | Raw request body |
| `{{bodyJson}}` | Pretty-printed JSON body |
| `{{method}}` | HTTP method (e.g., `POST`) |
| `{{headers}}` | Request headers |
| `{{path}}` | Request path |
| `{{query}}` | Query string parameters |
| `{{timestamp}}` | Time the webhook was received |

You can tailor the template to give your agent more context. For example:

```
A GitHub push event just arrived. Summarize the changes and open a PR if any tests are affected.

Payload:
{{bodyJson}}
```

## Managing Your Webhook

Once set up, the Webhook Integration card in Settings gives you several controls:

### Pause and Resume

Toggle the **Active/Paused** switch to temporarily stop accepting webhooks without deleting the URL. When paused, incoming requests are rejected. Resume at any time to start accepting them again.

### Rotate URL

If your webhook URL is compromised, click **Rotate URL** to generate a new one. This immediately invalidates the old URL, so you will need to update your integrations with the new URL afterward. A confirmation dialog is shown before rotation.

### Webhook Authentication (Optional)

For additional security, you can require inbound requests to include a shared secret header. This is useful when the sending service supports webhook signing.

1. Toggle **Webhook Authentication** to enabled
2. Set the **Secret Header** name (default: `x-webhook-secret`)
3. Enter a **Shared Secret** value
4. Click **Save**

Requests missing the header or providing an incorrect secret are rejected.

{% callout type="note" title="Authentication is optional" %}
The webhook URL itself is already a credential (128-bit entropy). Authentication adds a second layer and is only needed if your sending service requires or supports it.
{% /callout %}

## Viewing Webhook Activity

KiloClaw webhooks also appear in the **Webhooks** page under Cloud (read only). From there you can click **View Captured Requests** to inspect recent payloads, response codes, and timing. This is useful for debugging integration issues.

## Example: GitHub Push Notifications

1. Set up a webhook in your KiloClaw Settings
2. In your GitHub repository, go to **Settings > Webhooks > Add webhook**
3. Paste your KiloClaw webhook URL as the **Payload URL**
4. Set **Content type** to `application/json`
5. Select the events you want to trigger on (e.g., **Just the push event**)
6. Click **Add webhook**

Now every push to that repository sends a payload to your agent. Customize the prompt template to tell the agent what to do with it. You could have it summarize commits, run checks, notify a channel, or anything else.

## Related

- [Scheduled Triggers](/docs/kiloclaw/triggers/scheduled)
- [Triggers Overview](/docs/kiloclaw/triggers)
- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)
- [GitHub Integration](/docs/kiloclaw/development-tools/github)
- [Connecting Chat Platforms](/docs/kiloclaw/chat-platforms)
