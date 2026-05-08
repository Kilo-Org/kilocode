---
title: "Message Feedback"
description: "Rate assistant responses with thumbs up/down to help Kilo improve"
---

# Message Feedback

You can give a thumbs up or thumbs down to any response Kilo gives you. It's a quick way to tell us when something worked well, or when it didn't.

{% callout type="info" %}
Feedback is only available when telemetry is on. If you turn telemetry off, the buttons no longer display. See [Turning it off](#turning-it-off) below.
{% /callout %}

## How to use it

{% tabs %}
{% tab label="VSCode" %}

When Kilo finishes a response, you'll see thumbs-up and thumbs-down buttons next to the **Copy response** button. Click one to send your rating. Click the same button again to take it back, or click the other one to change your mind.

If you reload the window or switch to a different session, the feedback status will be reset.

{% /tab %}

{% tab label="CLI" %}

In the terminal, two keybinds rate the most recent assistant message:

| Action | Keybind |
|---|---|
| Helpful | `<leader>=` |
| Not helpful | `<leader>-` |

`<leader>` defaults to `Ctrl+X`, so you press `Ctrl+X` and then `=` for thumbs-up, or `Ctrl+X` and then `-` for thumbs-down.

{% /tab %}
{% /tabs %}
## Why it matters

Your feedback is the most direct way to tell us what's working and what isn't. We use it to tune the prompts behind Kilo's behavior, pick better default models, and find and fix problems faster than we could on our own.

## What we send

When you rate a response, here's what gets sent:

- That you rated a response thumbs up or thumbs down.
- The provider and model ID that produced the response (for example, `anthropic` and `claude-sonnet-4-5`).
- For responses that came through Kilo Gateway, the request ID so we can match the rating back to the session.

No further information is included in the rating feedback. For more information on telemetry, see [PRIVACY.md](https://github.com/Kilo-Org/kilocode/blob/main/PRIVACY.md).

## Turning it off

Feedback is part of telemetry, so turning telemetry off will cause the feedback buttons to no longer appear.

{% tabs %}
{% tab label="VSCode" %}

Open Settings (`Cmd+,` on Mac, `Ctrl+,` on Windows/Linux), search for **`telemetry.telemetryLevel`**, and set it to **Off**. The feedback buttons will no longer appear. Set it back to **All** to bring them back. (For more on what this setting controls, see [VS Code's telemetry docs](https://code.visualstudio.com/docs/getstarted/telemetry).)

{% /tab %}

{% tab label="CLI" %}

Set `KILO_TELEMETRY_LEVEL=off` in your environment before starting Kilo:

```bash
KILO_TELEMETRY_LEVEL=off kilo
```

With telemetry off, pressing the feedback keybinds shows a message saying feedback is disabled, and nothing is sent.

{% /tab %}
{% /tabs %}
