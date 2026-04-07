---
title: "DevilClaw"
description: "One-click deployment of your personal AI agent with OpenClaw"
---

# DevilClaw 🦀

DevilClaw is devil's hosted [OpenClaw](https://openclaw.ai) service — a one-click deployment that gives you a personal AI agent without the complexity of self-hosting. OpenClaw is a 24/7, open source AI agent that connects to chat platforms like Telegram, Discord, and Slack so it can take real actions automatically, not just chat.

DevilClaw is powered by devilcode. The API key is platform-managed, so you never need to bring your own. DevilClaw is currently in **Beta**.

## Why DevilClaw?

- **No infrastructure setup** — Skip Docker, servers, and configuration files
- **Instant provisioning** — Your agent is ready in seconds
- **Powered by devilcode** — API key is automatically generated and refreshed
- **Uses existing credits** — Runs on your devil Gateway balance
- **Multiple free models** — Choose from several models at no additional cost
- **Web UI included** — Access your agent's web interface directly from the dashboard

## Prerequisites

- **devil account** — Sign up at [devil.ai](https://devil.ai) if you haven't already
- **Model access** — DevilClaw uses **devil Gateway by default**, which provides access to **500+ AI models** through a single integration.

You can also run DevilClaw using:

- **Your own provider API keys (BYOK)** such as Anthropic, OpenAI, Google, or other supported providers.

## Creating an Instance

1. Navigate to your [devil profile](https://app.devil.ai/profile)
2. Click **Claw** in the left navigation

{% image src="/docs/img/DevilClaw/profile-claw-nav.png" alt="Profile page showing Claw navigation" width="400" caption="Claw navigation in profile sidebar" /%}

3. Click **Create Instance**
4. Select your preferred model from the dropdown. See all available models at the [devil Leaderboard](https://devil.ai/leaderboard#all-models).

{% image src="/docs/img/DevilClaw/create-instance.png" alt="Create instance modal with model selection" width="600" caption="Model selection during instance creation" /%}

5. Optionally configure chat channels (Telegram, Discord, Slack) — you can also do this later from [Settings](/docs/DevilClaw/dashboard#settings)
6. Click **Create & Provision**

Your instance will be provisioned in seconds. Each instance runs on a dedicated machine with 2 shared vCPUs, 3 GB RAM, and a 10 GB persistent SSD. Once created in a region, your instance always runs there.

## Managing Your Instance

The DevilClaw dashboard gives you full control over your instance.

{% image src="/docs/img/DevilClaw/instance-dashboard.png" alt="Instance dashboard with controls and status" width="800" caption="Instance management dashboard" /%}

### Controls

- **Start Machine** — Boot a stopped instance (up to 60 seconds)
- **Restart OpenClaw** — Quick restart of just the OpenClaw process; the machine stays up
- **Redeploy** — This will stop the machine, apply any pending image or config updates, and restart it. The machine will be briefly offline.
- **OpenClaw Doctor** — Run diagnostics and auto-fix common issues

For full details on each control and when to use them, see the [Dashboard Reference](/docs/DevilClaw/dashboard).

### Changelog

The dashboard shows recent platform updates. Some updates include a deploy hint — either **Redeploy Required** or **Redeploy Suggested** — to let you know when to redeploy your instance.

### Pairing Requests

When you initialize a new channel for the first time, or a new device connects to the Control UI, you'll see a pairing request on the dashboard that you need to approve. See [Pairing Requests](/docs/DevilClaw/chat-platforms#pairing-requests) for details.

## Accessing Your Agent

1. Click **Open** on your dashboard to launch the OpenClaw web interface

{% image src="/docs/img/DevilClaw/openclaw-dashboard.png" alt="OpenClaw web interface" width="800" caption="OpenClaw web UI" /%}

## Using your OpenClaw Agent

OpenClaw lets you customize your own AI assistant that can actually take action — check your email, manage your calendar, control smart devices, browse the web, and message you on Telegram or Discord when something needs attention. It's like having a personal assistant that runs 24/7, with the skills and access you choose to give it.

### Browser Tool

DevilClaw includes a headless Chromium browser, enabling your agent to browse the web, take screenshots, and automate web interactions using the OpenClaw browser tool. This works out of the box with the "full" tool profile — no additional setup needed.

### Default Tool Profile

New DevilClaw instances deploy with the **full** tool profile by default, giving your agent unrestricted access to all available tools — filesystem operations, shell execution, web search, browser automation, messaging, memory, sub-agents, and more.

For more information on use cases:

- [OpenClaw Showcase](https://docs.openclaw.ai/start/showcase)
- [100 hours of OpenClaw in 35 Minutes](https://www.youtube.com/watch?v=_kZCoW-Qxnc)
- [Clawhub](https://clawhub.ai/): search for skills

## Related

- [Dashboard Reference](/docs/DevilClaw/dashboard)
- [Connecting Chat Platforms](/docs/DevilClaw/chat-platforms)
- [Troubleshooting](/docs/DevilClaw/troubleshooting)
- [DevilClaw Pricing](/docs/DevilClaw/faq/pricing)
- [Gateway Usage and Billing](/docs/gateway/usage-and-billing)
- [Agent Manager](/docs/automate/agent-manager)
- [OpenClaw Documentation](https://docs.openclaw.ai)
