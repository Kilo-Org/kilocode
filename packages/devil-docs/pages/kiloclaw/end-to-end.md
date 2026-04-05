---
title: "Setup walkthrough"
description: "Start-to-finish guide for configuring your KiloClaw instance"
---

# Setup walkthrough

This guide walks you through a full KiloClaw setup — from creating accounts to scheduling your first automated workflow. Plan for about 60 minutes.

## Planning your setup

For most users, a useful KiloClaw configuration involves:

1. A **chat platform** (called a "channel" in OpenClaw) so you can message your Claw
2. **Google services** for email, calendar, and Drive
3. **GitHub** for code and markdown syncing

### Use dedicated accounts for your Claw

We recommend creating **separate accounts** for your KiloClaw rather than connecting it to your personal accounts. This applies to Google, GitHub, and any other services you connect. A dedicated account improves isolation — your personal data stays separate, and you can control exactly what access the Claw has by sharing or delegating only what you want.

### Chat platform options

- **[Kilo Chat](https://app.kilo.ai)** — available in the web app and coming soon to iOS and Android; requires zero configuration
- **[Telegram](/docs/kiloclaw/chat-platforms/telegram)** — easy to set up, private by default
- **[Discord](/docs/kiloclaw/chat-platforms/discord)** — moderate setup
- **[Slack](/docs/kiloclaw/chat-platforms/slack)** — most involved setup

{% callout type="warning" title="Chain-of-connection security" %}
If your Claw has access to sensitive data (like your email), be careful which chat platform you connect it to. On broadly-accessible platforms like Slack or Discord, anyone on the server could potentially message your Claw and access that data. If you're connecting sensitive integrations, use a private platform like Kilo Chat or Telegram.
{% /callout %}

The steps below walk you through this configuration.

## Preflight Steps

Take these steps before configuring your Claw.

If you are doing a [1-1 configuration call with Kilo](https://kilo.ai/kiloclaw/config-service), please complete these steps before the call.

### Google

Configuring Google services is by far the most involved part of setting up your Claw.

Before configuring, take these preflight steps:

1. **Create a Google Account for your Claw** — Go to [google.com](https://www.google.com/) and create a new Google/Gmail account dedicated to your KiloClaw. Something like `yourname.bot@gmail.com` works well.

2. **Set up Google Cloud** — Visit [console.cloud.google.com](https://console.cloud.google.com). Accept the terms of service and click "Start my free tier". You may need to add a credit card for identity verification.

   {% callout type="info" %}
   Nothing KiloClaw does costs any money with Google.
   {% /callout %}

3. **Install Docker** — KiloClaw configures Google by running a Docker container on your machine. Download Docker at [docker.com](https://www.docker.com/), then open it. You don't need to sign in or create a Docker account.

## Other Services

1. **Create a GitHub account for your Claw** — Using your new Gmail address, create a matching GitHub account for your Claw.

## Set up a messaging platform

Your Claw needs a way to communicate with you. **[Kilo Chat](https://app.kilo.ai)** requires no setup — just open the web app. For other platforms, follow the relevant guide:

- [Telegram](/docs/kiloclaw/chat-platforms/telegram) — about 2 minutes
- [Discord](/docs/kiloclaw/chat-platforms/discord) — about 10 minutes
- [Slack](/docs/kiloclaw/chat-platforms/slack) — about 15 minutes; always use the manifest

{% callout type="tip" %}
If you're not sure which to pick, Kilo Chat (no setup) or Telegram (2 minutes) are the easiest options.
{% /callout %}

## Set up Google OAuth

This lets your Claw act as the bot Google account — sending email, reading calendar, and more. Takes about 15 minutes.

Prerequisites: Docker is installed and running, and your bot Google account is already created.

1. In the KiloClaw dashboard, go to **Settings → Google Account** and copy the Docker command shown.
2. Open a terminal and run the command.
3. Follow the steps in the console:
   - At each step, confirm you're logged in to the bot account (check the top-right corner of the screen).
   - After project creation, confirm you're in the correct project.
   - The last step may look like it failed — this is expected.

For full details, see the [Google setup guide](/docs/kiloclaw/development-tools/google).

## Set up GitHub

A dedicated bot GitHub account is strongly recommended. Takes about 7 minutes.

**Create a Personal Access Token (PAT):**

1. In GitHub, go to **Settings → Developer Settings → Personal Access Tokens → Classic → Generate new token**.
2. Select these scopes: `repo`, `workflow`, `write:org`, `read:user`.

For full details, see the [GitHub setup guide](/docs/kiloclaw/development-tools/github).

**Set up a private workspace repo:**

Once GitHub is connected, ask your Claw to back up its workspace:

> Use your GitHub access to back up your workspace. Make it a GitHub repo and push it as a private repo. Add me as a member so I can see it. Then set up a cron job to pull, rebase, and push any changes at least once an hour.

After sending that, redeploy from the dashboard to pick up the changes.

## Grant email and calendar access

After OAuth is set up, decide how much access to give your Claw to your personal accounts.

| Option                  | What it does                                                          | Best for                                   | Configured from                                         |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Forward select emails   | A Gmail filter forwards specific senders or labels to the bot account | Targeted use cases like newsletter digests | Your personal account                                   |
| Forward all email       | Forwards your full inbox to the bot                                   | Simpler setups where noise is acceptable   | Bot account (destination)                               |
| Full account delegation | Gives the bot direct read/write access to your personal account       | Maximum capability                         | Your personal account — Gmail Settings → Add a delegate |

{% callout type="info" %}
Email forwarding is configured from the **destination** (bot) account. Account delegation is configured from the **source** (personal) account.
{% /callout %}

**Push notifications:** by default, your Claw wakes up on every incoming email. If you'd prefer a digest (e.g., once at 7am), disable push notifications in **Settings → Google Account** on the [dashboard](/docs/kiloclaw/dashboard) — otherwise it processes each email as it arrives.

**Google Calendar:** share your personal calendar from your personal Google account. Go to **Google Calendar → Settings → Settings for my calendars → [your calendar] → Share with specific people**, and add the bot account.

## Enable auto-approval

By default, KiloClaw asks for confirmation before every tool call. To let it act freely, go to the [KiloClaw dashboard](https://app.kilo.ai/claw) and enable auto-approval in the **Default Permissions** section.

## Prompt and schedule work

### How to prompt your Claw

Just tell it in plain language what you want. Be specific. If you want it to remember something across sessions, tell it to write it down in a specific file.

### Scheduling jobs

Tell your Claw when and what to do — for example:

> Schedule a daily cron job at 7am to summarize my emails and send me a digest.

{% callout type="tip" %}
Mentioning "cron job" helps it understand you want a recurring scheduled task.
{% /callout %}

### Skills

Reusable capabilities that extend what your Claw can do — things like triaging email, summarizing documents, or managing GitHub issues. You can install a pre-built skill by asking your Claw:

> Install the [skill name] skill.

Or ask your Claw to build a custom skill from scratch — it has a built-in skill-builder skill for exactly this. You can explore popular skills and use case inspiration at the [KiloClaw Bytes library](https://kilo.ai/kiloclaw/bytes).

## Manage inference

**Model picker:** Balanced is a good starting point. Frontier is more capable but significantly more expensive.

You can also use your KiloPass credits — find this under **Profile** in the dashboard.
