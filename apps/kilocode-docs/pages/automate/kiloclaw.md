---
title: "KiloClaw"
description: "One-click deployment of your personal AI agent with OpenClaw"
---

# KiloClaw 🦀

KiloClaw is Kilo's hosted [OpenClaw](https://openclaw.ai) service—a one-click deployment that gives you a personal AI agent without the complexity of self-hosting. OpenClaw is an open source AI agent that connects to chat platforms like WhatsApp, Telegram, and Discord.

## Why KiloClaw?

- **No infrastructure setup** — Skip Docker, servers, and configuration files
- **Instant provisioning** — Your agent is ready in seconds
- **Uses existing credits** — Runs on your Kilo Gateway balance
- **Multiple free models** — Choose from several models at no additional cost
- **Web UI included** — Access your agent's web interface from the instance dashboard

## Prerequisites

Before creating an instance:

- **Kilo account** — Sign up at [kilo.ai](https://kilo.ai) if you haven't already
- **Gateway credits** — KiloClaw uses your existing [Gateway credits](/docs/gateway/usage-and-billing) for model inference

## Creating an Instance

1. Navigate to your [Kilo profile](https://app.kilo.ai/profile)
2. Click **Claw** in the left navigation

{% image src="/docs/img/kiloclaw/profile-claw-nav.png" alt="Profile page showing Claw navigation" width="400" caption="Claw navigation in profile sidebar" /%}

3. Click **Create Instance**
4. Select your preferred model from the dropdown. See all available models at the [Kilo Leaderboard](https://kilo.ai/leaderboard#all-models).

{% image src="/docs/img/kiloclaw/create-instance.png" alt="Create instance modal with model selection" width="600" caption="Model selection during instance creation" /%}

5. Click **Create & Provision**

Your instance will be provisioned and ready within seconds.

## Managing Your Instance

Once created, you can control your instance from the dashboard.

{% image src="/docs/img/kiloclaw/instance-dashboard.png" alt="Instance dashboard with controls and status" width="800" caption="Instance management dashboard" /%}

### Instance Controls

- **Start** — Boot up a stopped instance
- **Stop** — Shut down the instance (preserves configuration)
- **Restart** — Stop and start the instance

### Dashboard Tabs

| Tab          | Purpose                                         |
| ------------ | ----------------------------------------------- |
| **Overview** | Instance status, uptime, and resource usage     |
| **Settings** | Model configuration and instance parameters     |
| **Actions**  | Quick actions and connected platform management |

## Accessing Your Agent

To connect to your agent's web interface:

1. Click **Get Access Code** from your instance dashboard
2. Copy the one-time access code (expires in 10 minutes)

{% image src="/docs/img/kiloclaw/access-code-modal.png" alt="Access code modal showing one-time code" width="500" caption="One-time access code with 10-minute expiration" /%}

3. Click the **Open Claw** button in the top-right corner of your instance dashboard
4. Enter your access code to authenticate

{% image src="/docs/img/kiloclaw/openclaw-dashboard.png" alt="OpenClaw web interface" width="800" caption="OpenClaw web UI" /%}

## Connecting Chat Platforms

OpenClaw supports integration with popular messaging platforms:

- WhatsApp
- Telegram
- Discord
- Slack
- And more

For platform-specific setup instructions, refer to the [OpenClaw documentation](https://docs.openclaw.ai).

## Using your OpenClaw Agent

OpenClaw lets you customize your own AI assistant that can actually take action — check your email, manage your calendar, control smart devices, browse the web, and message you on Telegram or Discord when something needs attention. It's like having a personal assistant that runs 24/7, with the skills and access you choose to give it.

For more information on use cases for OpenClaw, see:

- [OpenClaw Showcase](https://docs.openclaw.ai/start/showcase)
- [100 hours of OpenClaw in 35 Minutes](https://www.youtube.com/watch?v=_kZCoW-Qxnc)
- [Clawhub](https://clawhub.ai/): search for skills

## Pricing

KiloClaw uses your existing Kilo Gateway credits—there's no separate billing or subscription:

- **Instance hosting** — Free for 7 days during beta
- **Model inference** — Charged against your Gateway credit balance
- **Free models** — Several models are available at no cost. See the [Kilo Leaderboard](https://kilo.ai/leaderboard#all-models) for current availability.

See [Gateway Usage and Billing](/docs/gateway/usage-and-billing) for credit pricing details.

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

- [Gateway Usage and Billing](/docs/gateway/usage-and-billing)
- [Agent Manager](/docs/automate/agent-manager)
- [OpenClaw Documentation](https://docs.openclaw.ai)
