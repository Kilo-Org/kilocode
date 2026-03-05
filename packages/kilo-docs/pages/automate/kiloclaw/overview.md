---
title: "KiloClaw"
description: "One-click deployment of your personal AI agent with OpenClaw"
---

# KiloClaw 🦀

KiloClaw is Kilo's hosted [OpenClaw](https://openclaw.ai) service — a one-click deployment that gives you a personal AI agent without the complexity of self-hosting. OpenClaw is an open source AI agent that connects to chat platforms like Telegram, Discord, and Slack.

KiloClaw is powered by KiloCode. The API key is platform-managed, so you never need to bring your own. KiloClaw is currently in **Beta**.

## Why KiloClaw?

- **No infrastructure setup** — Skip Docker, servers, and configuration files
- **Instant provisioning** — Your agent is ready in seconds
- **Powered by KiloCode** — API key is automatically generated and refreshed
- **Uses existing credits** — Runs on your Kilo Gateway balance
- **Multiple free models** — Choose from several models at no additional cost
- **Web UI included** — Access your agent's web interface directly from the dashboard

## Prerequisites

- **Kilo account** — Sign up at [kilo.ai](https://kilo.ai) if you haven't already
- **Gateway credits** — KiloClaw uses your existing [Gateway credits](/docs/gateway/usage-and-billing) for model inference

## Creating an Instance

1. Navigate to your [Kilo profile](https://app.kilo.ai/profile)
2. Click **Claw** in the left navigation

{% image src="/docs/img/kiloclaw/profile-claw-nav.png" alt="Profile page showing Claw navigation" width="400" caption="Claw navigation in profile sidebar" /%}

3. Click **Create Instance**
4. Select your preferred model from the dropdown. See all available models at the [Kilo Leaderboard](https://kilo.ai/leaderboard#all-models).

{% image src="/docs/img/kiloclaw/create-instance.png" alt="Create instance modal with model selection" width="600" caption="Model selection during instance creation" /%}

5. Optionally configure chat channels (Telegram, Discord, Slack) — you can also do this later from [Settings](/docs/automate/kiloclaw/dashboard#settings)
6. Click **Create & Provision**

Your instance will be provisioned in seconds. Each instance runs on a dedicated machine with 2 shared vCPUs, 3 GB RAM, and a 10 GB persistent SSD. Once created in a region, your instance always runs there.

## Managing Your Instance

The KiloClaw dashboard gives you full control over your instance.

{% image src="/docs/img/kiloclaw/instance-dashboard.png" alt="Instance dashboard with controls and status" width="800" caption="Instance management dashboard" /%}

### Controls

- **Start Machine** — Boot a stopped instance (up to 60 seconds)
- **Restart OpenClaw** — Quick restart of just the OpenClaw process; the machine stays up
- **Redeploy** — This will stop the machine, apply any pending image or config updates, and restart it. The machine will be briefly offline.
- **OpenClaw Doctor** — Run diagnostics and auto-fix common issues

For full details on each control and when to use them, see the [Dashboard Reference](/docs/automate/kiloclaw/dashboard).

### Changelog

The dashboard shows recent platform updates. Some updates include a deploy hint — either **Redeploy Required** or **Redeploy Suggested** — to let you know when to redeploy your instance.

### Pairing Requests

When you initialize a new channel for the first time, or a new device connects to the Control UI, you'll see a pairing request on the dashboard that you need to approve. See [Pairing Requests](/docs/automate/kiloclaw/chat-platforms#pairing-requests) for details.

## Accessing Your Agent

1. Click **Access Code** to get a one-time code (expires in 10 minutes)

{% image src="/docs/img/kiloclaw/access-code-modal.png" alt="Access code modal showing one-time code" width="500" caption="One-time access code with 10-minute expiration" /%}

2. Click **Open** to launch the OpenClaw web interface
3. Enter your access code to authenticate

{% image src="/docs/img/kiloclaw/openclaw-dashboard.png" alt="OpenClaw web interface" width="800" caption="OpenClaw web UI" /%}

## Using your OpenClaw Agent

OpenClaw lets you customize your own AI assistant that can actually take action — check your email, manage your calendar, control smart devices, browse the web, and message you on Telegram or Discord when something needs attention. It's like having a personal assistant that runs 24/7, with the skills and access you choose to give it.

For more information on use cases:

- [OpenClaw Showcase](https://docs.openclaw.ai/start/showcase)
- [100 hours of OpenClaw in 35 Minutes](https://www.youtube.com/watch?v=_kZCoW-Qxnc)
- [Clawhub](https://clawhub.ai/): search for skills

## Tool Configuration

KiloClaw deploys with the **full** tool profile, giving your agent unrestricted access to all available tools — filesystem operations (read, write, edit), shell execution, web search, messaging, memory, sub-agents, and more.

Shell commands are still gated by an **allowlist** — unknown commands trigger an approval prompt in the Control UI, while common dev tools are pre-approved.

### Changing the Tool Profile

If you want to restrict your agent's capabilities, you can change the tool profile from the OpenClaw Control UI:

1. Open your agent's Control UI (via **OpenClaw** on the dashboard)
2. Navigate to **Settings** → **Config** → **Tools** → **Tool Profile**
3. Select a different profile:

| Profile       | What's included                                             |
| ------------- | ----------------------------------------------------------- |
| **full**      | All tools, no restrictions (KiloClaw default)               |
| **coding**    | Filesystem, exec, memory, sessions, sub-agents, cron, image |
| **messaging** | Session management and messaging only                       |
| **minimal**   | Session status only                                         |

Your choice persists across restarts — KiloClaw won't overwrite a customized profile.

For a complete and up-to-date tool configuration reference, see the [OpenClaw Tools documentation](https://docs.openclaw.ai/tools#tools-openclaw).

## Limitations

KiloClaw is currently in **beta**. Current constraints include:

- **One instance per account** — Each user can run a single KiloClaw instance
- **Model availability** — Some models may have rate limits during high demand
- **Session persistence** — Chat history may be cleared during beta updates
- **Feature parity** — Not all OpenClaw features are available in the hosted version yet

{% callout type="info" %}
Have feedback or running into issues? Join the [Kilo Discord](https://kilo.ai/discord) and share it in the KiloClaw channel.
{% /callout %}

## Related

- [Dashboard Reference](/docs/automate/kiloclaw/dashboard)
- [Connecting Chat Platforms](/docs/automate/kiloclaw/chat-platforms)
- [Troubleshooting](/docs/automate/kiloclaw/troubleshooting)
- [KiloClaw Pricing](/docs/automate/kiloclaw/pricing)
- [Gateway Usage and Billing](/docs/gateway/usage-and-billing)
- [Agent Manager](/docs/automate/agent-manager)
- [OpenClaw Documentation](https://docs.openclaw.ai)
