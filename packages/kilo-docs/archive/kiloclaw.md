# KiloClaw documentation (archived)

KiloClaw is end of life. This file is an archive of the former public docs for support reference. It is no longer published on kilo.ai/docs.

## KiloClaw

<!-- source: pages/kiloclaw/overview.md -->

# KiloClaw 🦀

KiloClaw is Kilo's hosted [OpenClaw](https://openclaw.ai) service — a one-click deployment that gives you a personal or organization-scoped AI agent without the complexity of self-hosting. OpenClaw is a 24/7, open source AI agent that connects to Kilo Chat and optional chat platforms like Telegram, Discord, and Slack so it can take real actions automatically, not just chat.

KiloClaw is powered by Kilo Code. The API key is platform-managed, so you never need to bring your own.

## Why KiloClaw?

- **No infrastructure setup** — Skip Docker, servers, and configuration files
- **Instant provisioning** — Your agent is ready in seconds
- **Kilo Chat included** — Use the first-party Kilo Chat channel without token setup
- **Powered by Kilo Code** — API key is automatically generated and refreshed
- **Uses existing credits** — Runs on your Kilo Gateway balance
- **Multiple free models** — Choose from several models at no additional cost
- **Web UI included** — Access your agent's web interface directly from the dashboard

## Prerequisites

- **Kilo account** — Sign up at [kilo.ai](https://kilo.ai) if you haven't already
- **Model access** — KiloClaw uses **Kilo Gateway by default**, which provides access to **500+ AI models** through a single integration.

Depending on your setup, you can also use:

- **Your own provider API keys (BYOK)** such as Anthropic, OpenAI, Google, or other supported providers.
- **Organization access** if your organization has KiloClaw enabled and you want the instance scoped to that organization.

## Creating an Instance


1. Navigate to your [Kilo profile](https://app.kilo.ai/profile)
2. Click **Claw** in the left navigation

{% image src="/docs/img/kiloclaw/profile-claw-nav.png" alt="Profile page showing Claw navigation" width="400" caption="Claw navigation in profile sidebar" /%}

3. Click **Create Instance**
4. Your instance will use **Kilo Auto Efficient** as the default model. You can optionally select a different model from the dropdown — see all available models at the [Kilo Leaderboard](https://kilo.ai/leaderboard#all-models).

{% image src="/docs/img/kiloclaw/create-instance.png" alt="Create instance modal with model selection" width="600" caption="Model selection during instance creation" /%}

5. Optionally configure third-party chat channels (Telegram, Discord, Slack) — Kilo Chat is already available, and you can add other channels later from [Settings](/docs/kiloclaw/dashboard#settings)
6. Click **Create & Provision**

Your instance will be provisioned in seconds. Each instance runs on a dedicated machine with 2 shared vCPUs, 3 GB RAM, and a 10 GB persistent SSD. Once created in a region, your instance always runs there.

## Organization KiloClaw

If your organization has KiloClaw enabled, you can use an organization-scoped instance for work that belongs to that organization. The core KiloClaw experience is the same as a personal instance, with these differences:

- Organization instances are separated from your **Personal** instance in KiloClaw lists.
- Provisioning depends on your organization membership and the organization's KiloClaw entitlement.
- Instance ownership and routing are scoped to the organization, so use organization-approved accounts and credentials for connected services.

## Managing Your Instance

The KiloClaw dashboard gives you full control over your instance.

{% image src="/docs/img/kiloclaw/instance-dashboard.png" alt="Instance dashboard with controls and status" width="800" caption="Instance management dashboard" /%}

### Controls

- **Start Machine** — Boot a stopped instance (up to 60 seconds)
- **Restart OpenClaw** — Quick restart of just the OpenClaw process; the machine stays up
- **Redeploy** — This will stop the machine, apply any pending image or config updates, and restart it. The machine will be briefly offline.
- **OpenClaw Doctor** — Run diagnostics and auto-fix common issues

For full details on each control and when to use them, see the [Dashboard Reference](/docs/kiloclaw/dashboard).

### Changelog

The dashboard shows recent platform updates. Some updates include a deploy hint — either **Redeploy Required** or **Redeploy Suggested** — to let you know when to redeploy your instance.

### Pairing Requests

When you initialize a new channel for the first time, or a new device connects to the Control UI, you'll see a pairing request on the dashboard that you need to approve. See [Pairing Requests](/docs/kiloclaw/chat-platforms#pairing-requests) for details.

## Accessing Your Agent

1. Click **Open** on your dashboard to launch the OpenClaw web interface

{% image src="/docs/img/kiloclaw/openclaw-dashboard.png" alt="OpenClaw web interface" width="800" caption="OpenClaw web UI" /%}

## Using your OpenClaw Agent

OpenClaw lets you customize your own AI assistant that can actually take action — check your email, manage your calendar, control smart devices, browse the web, and message you through Kilo Chat or connected third-party channels when something needs attention. It's like having a personal assistant that runs 24/7, with the skills and access you choose to give it.

### Browser Tool

KiloClaw includes a headless Chromium browser, enabling your agent to browse the web, take screenshots, and automate web interactions using the OpenClaw browser tool. This works out of the box with the "full" tool profile — no additional setup needed.

### Default Tool Profile

New KiloClaw instances deploy with the **full** tool profile by default, giving your agent unrestricted access to all available tools — filesystem operations, shell execution, web search, browser automation, messaging, memory, sub-agents, and more.

For more information on use cases:

- [OpenClaw Showcase](https://docs.openclaw.ai/start/showcase)
- [100 hours of OpenClaw in 35 Minutes](https://www.youtube.com/watch?v=_kZCoW-Qxnc)
- [Clawhub](https://clawhub.ai/): search for skills

## Related

- [Dashboard Reference](/docs/kiloclaw/dashboard)
- [Connecting Chat Platforms](/docs/kiloclaw/chat-platforms)
- [Troubleshooting](/docs/kiloclaw/troubleshooting)
- [KiloClaw Pricing](/docs/kiloclaw/faq/pricing)
- [Gateway Usage and Billing](/docs/gateway/usage-and-billing)
- [Agent Manager](/docs/automate/agent-manager)
- [OpenClaw Documentation](https://docs.openclaw.ai)

---

## KiloClaw Dashboard Reference

<!-- source: pages/kiloclaw/dashboard.md -->

# KiloClaw Dashboard

This page covers everything you can do from the KiloClaw dashboard. For getting started, see [KiloClaw Overview](/docs/kiloclaw/overview).

{% image src="/docs/img/kiloclaw/dashboard.png" alt="Connect account screen" width="800" caption="The KiloClaw Dashboard" /%}

## Personal and Organization Instances

The dashboard controls are the same for personal and organization-scoped KiloClaw instances. Organization instances are selected from the organization context and are listed separately from your **Personal** instance. Availability depends on your organization membership and KiloClaw entitlement.

## Instance Status

Your instance is always in one of these states as indicated by the status label at the top of your dashboard:

| Status | Label | Meaning |
|---|---|---|
| **Running** | Machine Online | Your agent is online and reachable |
| **Stopped** | Machine Stopped | The machine is off, but all your files and data are preserved |
| **Provisioned** | Provisioned | Your instance has been created but never started |
| **Destroying** | Destroying | The instance is being permanently deleted |

## Instance Controls

There are four actions you can take on your instance. Which ones are available depends on the current status.

### ▶️ Start Machine

Boots your instance. If this is the first time starting after provisioning, the machine is created; otherwise, the existing machine resumes. Can take up to 60 seconds.

Available when the instance is **stopped** or **provisioned**.

### 🔄 Restart OpenClaw

Restarts just the OpenClaw process without rebooting the machine. This is a quick way to recover from a process-level issue — active sessions will briefly disconnect and reconnect automatically.

Available when the instance is **running**.

### ↩️ Redeploy

Stops the machine, applies your current configuration (environment variables, secrets, channel tokens), and starts it again. When redeploying, you have two options:

- **Redeploy** — Redeploys using the same platform version your instance was originally set up with. Use this when you only need to apply configuration changes without changing the underlying platform.
- **Upgrade & Redeploy** — Upgrades your instance to the latest supported platform version, then redeploys. Use this to pick up new features and fixes from the changelog.

**Your files, git repos, cron jobs, and everything on your persistent volume are preserved.** Redeploy is not a factory reset — think of it as "apply config and restart" (or "upgrade and restart" if you choose **Upgrade & Redeploy**).

You should redeploy when:

- The changelog shows "Redeploy Required" or "Redeploy Suggested" (use **Upgrade & Redeploy**)
- You've changed channel tokens or secrets in Settings (use **Redeploy**)
- You want to pick up the latest platform updates (use **Upgrade & Redeploy**)

Available when the instance is **running**.

### 🩺 OpenClaw Doctor

Runs diagnostics and automatically fixes common configuration issues. This is the recommended first step when something isn't working. Output is shown in real time.

Available when the instance is **running**.

## Gateway Process

The Gateway Process tab shows the health of the OpenClaw process running inside your machine:

- **State** — Whether the process is Running, Stopped, Starting, Stopping, Crashed, or Shutting Down
- **Uptime** — How long it's been running since the last start
- **Restarts** — How many times the process has been automatically restarted
- **Last Exit** — The exit code and timestamp from the last time the process stopped or crashed

If the gateway crashes, it's automatically restarted. The machine itself can be running even when the gateway process is down — they're independent.

{% callout type="note" %}
Gateway process info is only available when the machine is running.
{% /callout %}

## Instance Specs

The specs of your instance, including number of CPUs, memory, and storage, are visible at the top right of the instance controls section.

## Settings

### Changing the Model

Select a model from the dropdown and click **Save & Provision**. The API key is platform-managed and refreshes automatically when you save — you never need to enter one. The key has a 30-day expiry.

For access to the full catalog of 335+ models, use the `/model` and `/models` commands in the [Control UI Chat](/docs/kiloclaw/control-ui#changing-models).

### Channels

Kilo Chat is always available as KiloClaw's first-party channel and does not need a token. You can also connect Telegram, Discord, and Slack by entering bot tokens in the Settings tab. See [Connecting Chat Platforms](/docs/kiloclaw/chat-platforms) for setup instructions.

{% callout type="info" %}
After saving channel tokens, you need to **Redeploy** or **Restart OpenClaw** for the changes to take effect.
{% /callout %}

### Version Pinning

You can pin your instance to a specific OpenClaw version and variant from the Settings tab. This gives you control over when you upgrade — your instance stays on the pinned version until you choose to change it.

Select a version and variant from the dropdowns and click **Save**. To return to automatic updates, clear the version pin and save.

See [Version Pinning](/docs/kiloclaw/control-ui/version-pinning) for details.

### Version Status Indicators

The Settings tab shows badges indicating your OpenClaw version status:

- **Update available** — A newer OpenClaw version is available in the catalog. Use **Upgrade & Redeploy** to move to that version.
- **Modified** — OpenClaw was updated on this machine independently of the image. Redeploying will revert to the image version.

These indicators help you track whether your running version is up to date or if a newer version exists in the catalog.

### Restore Default Config

If your OpenClaw configuration gets corrupted — for example, if the agent edits `openclaw.json` and introduces an error — you can restore it without a full redeploy.

In **Settings > Danger Zone**, click **Restore Config**. This will:

1. Back up your current `openclaw.json` to `/root/.openclaw/`
2. Rewrite `openclaw.json` from your environment variables (channel tokens, model settings, etc.)
3. Restart the gateway

Your files, workspace, and persistent data are not affected. Only the OpenClaw configuration file is reset.

> 💡 **Tip**
> If your instance is in a crash loop and you can't access the Control UI, try **Restore Config** from the KiloClaw dashboard first before redeploying.

{% callout type="warning" %}
This action cannot be undone. Make sure you've saved any important changes to your configuration before restoring.
{% /callout %}

### Stop, Destroy & Restore

At the bottom of Settings:

- **Stop Instance** — Shuts down the machine. All your data is preserved and you can start it again later.
- **Destroy Instance** — Permanently deletes your instance and all its data, including files, configuration, and workspace. This cannot be undone.
- **Restore Config** — Restores your original `openclaw.json` in your instance. The existing `openclaw.json` is backed up to `/root/.openclaw` before the restore takes place.

## Accessing the Control UI

When your instance is running you can access the [OpenClaw Control UI](/docs/kiloclaw/control-ui) — a browser-based dashboard for managing your agent, channels, sessions, exec approvals, and more:

1. Click **Open** to launch the OpenClaw web interface in a new tab

See the [Control UI reference](/docs/kiloclaw/control-ui) for a full overview of its capabilities.

{% callout type="warning" %}
Do not use the **Update** feature in the OpenClaw Control UI to update KiloClaw. Use **Redeploy** from the KiloClaw Dashboard instead. Updating via the Control UI will not apply the correct KiloClaw platform image and may break your instance.
{% /callout %}

## Pairing Requests

When your instance is running, the dashboard shows any pending pairing requests. These appear when:

- Someone messages your bot on a third-party chat channel for the first time
- A new browser or device connects to the Control UI

You need to **approve** each request before the user or device can interact with your agent. See [Pairing Requests](/docs/kiloclaw/chat-platforms#pairing-requests) for details.

## Changelog

The dashboard shows recent KiloClaw platform updates. Each entry is tagged as a **feature** or **bugfix**, and some include a deploy hint:

- **Redeploy Required** — You must redeploy for this change to take effect on your instance
- **Redeploy Suggested** — Redeploying is recommended but not strictly necessary

## Instance Lifecycle

| Action | What Happens | Data Preserved? |
|---|---|---|
| **Create & Provision** | Allocates storage in the best region available and saves your config. | N/A |
| **Start Machine** | Boots the machine and starts OpenClaw. | Yes |
| **Stop Instance** | Shuts down the machine. | Yes |
| **Restart OpenClaw** | Restarts the OpenClaw process. Machine stays up. | Yes |
| **Redeploy** | Stops, applies config, and restarts the machine (same version or upgraded). | Yes |
| **Destroy Instance** | Permanently deletes everything. | No |

## Machine Specs

Each instance runs on a dedicated machine — there is no shared infrastructure between users.

| Spec | Value |
|---|---|
| CPU | 2 shared vCPUs |
| Memory | 3 GB RAM |
| Storage | 10 GB persistent SSD |

Your storage is region-pinned — once your instance is created in a region (e.g., DFW), it always runs there. OpenClaw config lives at `/root/.openclaw` and the workspace at `/root/clawd`.

## Related

- [KiloClaw Overview](/docs/kiloclaw/overview)
- [OpenClaw Control UI](/docs/kiloclaw/control-ui)
- [Connecting Chat Platforms](/docs/kiloclaw/chat-platforms)
- [Troubleshooting](/docs/kiloclaw/troubleshooting)
- [KiloClaw Pricing](/docs/kiloclaw/faq/pricing)

---

## Pre-installed Software

<!-- source: pages/kiloclaw/pre-installed-software.md -->

# Pre-installed Software

Every KiloClaw instance ships with a curated set of system utilities, language runtimes, package managers, and CLI tools. This page documents everything that comes pre-installed in the KiloClaw Docker image so you know what's available out of the box. Where a specific version is listed it reflects the pin in the Dockerfile as of March 2026. Entries marked **unpinned** install the latest available version at image build time and may differ between releases.

## Base Image

KiloClaw is built on **Debian Bookworm** (`debian:bookworm-slim`). Since it's Debian-based, you can use `apt` to install additional packages at any time:

```bash
apt update && apt install -y <package>
```

{% callout type="info" %}
Packages installed via `apt` do not persist across redeploys. If you need a package to survive redeploys, install it from a cron job or startup script on the persistent volume.
{% /callout %}

## System Utilities

The following packages are installed via `apt` on top of the base image:

| Package | Description |
|---|---|
| `ca-certificates` | Root CA certificates for TLS verification |
| `curl` | HTTP client |
| `gnupg` | GPG encryption and signing |
| `git` | Version control |
| `unzip` | Archive extraction |
| `jq` | JSON processor |
| `ripgrep` | Fast recursive search (`rg`) |
| `rsync` | File synchronization |
| `zstd` | Zstandard compression |
| `build-essential` | GCC, make, and core build tools |
| `python3` | Python 3 interpreter (system default) |
| `ffmpeg` | Audio/video processing |
| `tmux` | Terminal multiplexer |

## Browser

| Tool | Description |
|---|---|
| Headless Chromium | Built-in browser for web browsing, screenshots, and CDP automation. Works with OpenClaw's browser tool out of the box. Requires the "full" tool profile. |

## Languages & Runtimes

| Language / Runtime | Version | Install Method |
|---|---|---|
| Node.js | 22.13.1 | Binary tarball (primary runtime) |
| Go | 1.26.0 | Binary tarball |
| Bun | 1.2.4 | Install script |
| Python 3 | Unpinned (Debian Bookworm default) | `apt` |

## Package Managers

These package managers are available for installing libraries and dependencies:

| Manager | Included Via |
|---|---|
| `npm` | Bundled with Node.js |
| `pnpm` | Installed via `npm` |
| `bun` | Bundled with Bun |

## CLI Tools

| Tool | Version / Source |
|---|---|
| GitHub CLI (`gh`) | Unpinned (GitHub apt repo) |
| 1Password CLI (`op`) | 2.32.1 (1Password apt repo) |

## npm Global Packages

The following packages are installed globally via `npm`:

| Package | Version |
|---|---|
| ClawHub CLI (`clawhub`) | Unpinned |
| mcporter | 0.7.3 |
| `@steipete/summarize` | 0.11.1 |

## OpenClaw Skills & Integrations

| Tool | Description |
|---|---|
| gog (gogcli) | Google Workspace CLI — Gmail, Calendar, Drive, Contacts, Sheets, Docs |
| blogwatcher | Monitor blogs and RSS/Atom feeds for updates |
| xurl | Authenticated requests to the X (Twitter) API |
| gifgrep | Search GIF providers, download results, extract stills |
| summarize | Summarize or extract text/transcripts from URLs and files |
| goplaces | Location and places lookup |

## Installing Additional Tools

Your agent can install additional tools at runtime:

- **Go packages:** `go install github.com/example/tool@latest`
- **Node packages:** `npm install -g <package>`
- **Python packages:** `pip install <package>`

{% callout type="tip" %}
These tools receive updates when you **Upgrade & Redeploy** your instance from the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#redeploy). Check the changelog for image update announcements.
{% /callout %}

## Related

- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)
- [Machine Specs](/docs/kiloclaw/dashboard#machine-specs)
- [Troubleshooting](/docs/kiloclaw/troubleshooting)

---

## Setup walkthrough

<!-- source: pages/kiloclaw/end-to-end.md -->

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

- **[Kilo Chat](https://app.kilo.ai)** — available in the Kilo web and mobile apps, plus supported Kilo Code editor and TUI surfaces; requires zero configuration
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

{% callout type="tip" title="Google Workspace users" %}
If your organization uses Google Workspace, create the dedicated bot account inside your Workspace domain (e.g., `claw@yourcompany.com`) rather than as a standalone `@gmail.com` account.

A Workspace-managed account benefits from your organization's admin policies, making configuration easier.
{% /callout %}

2. **Set up Google Cloud** — Visit [console.cloud.google.com](https://console.cloud.google.com). Accept the terms of service and click "Start my free tier". You may need to add a credit card for identity verification.

   {% callout type="info" %}
   Nothing KiloClaw does costs any money with Google.
   {% /callout %}

3. **Install Docker** — KiloClaw configures Google by running a Docker container on your machine. Download Docker at [docker.com](https://www.docker.com/), then open it. You don't need to sign in or create a Docker account.

## Other Services

1. **Create a GitHub account for your Claw** — Using your new Gmail address, create a matching GitHub account for your Claw.

## Set up a messaging platform

Your Claw needs a way to communicate with you. **[Kilo Chat](https://app.kilo.ai)** requires no setup — open the Kilo web or mobile app, or use a supported Kilo Code editor or TUI surface. For other platforms, follow the relevant guide:

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

| Option | What it does | Best for | Configured from |
|---|---|---|---|
| Forward select emails | A Gmail filter forwards specific senders or labels to the bot account | Targeted use cases like newsletter digests | Your personal account |
| Forward all email | Forwards your full inbox to the bot | Simpler setups where noise is acceptable | Bot account (destination) |
| Full account delegation | Gives the bot direct read/write access to your personal account | Maximum capability | Your personal account — Gmail Settings → Add a delegate |

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

**Model picker:** Efficient is a good starting point. Frontier is more capable but significantly more expensive.

You can also use your [Kilo Pass](https://kilo.ai/pricing/kilo-pass) credits — find this under **Profile** in the dashboard.

---

## Control UI Overview

<!-- source: pages/kiloclaw/control-ui/overview.md -->

# OpenClaw Control UI

The Control UI is a browser-based dashboard (built with Vite + Lit) served by the OpenClaw Gateway on the same port as the gateway itself (default: `http://localhost:18789/`). It connects via WebSocket and gives you real-time control over your agent, channels, sessions, and system configuration. For KiloClaw users, see [Accessing the Control UI](/docs/kiloclaw/dashboard#accessing-the-control-ui) to get started.

## Features

- **Chat** — Send messages, stream responses with live tool-call output, view history, and abort runs.
- **Channels** — View the status of connected messaging platforms, scan QR codes for login, and edit per-channel config.
- **Sessions** — List active sessions with thinking and verbose overrides.
- **Cron Jobs** — Create, edit, enable/disable, run, and view history of scheduled tasks.
- **Skills** — View status, enable/disable, install, and manage API keys for skills.
- **Nodes** — List paired devices and their capabilities.
- **Exec Approvals** — Edit gateway or node command allowlists. See [Exec Approvals](/docs/kiloclaw/control-ui/exec-approvals).
- **Config** — View and edit `openclaw.json` with schema-based form rendering and a raw JSON editor.
- **Logs** — Live tail of gateway logs with filtering and export.
- **Debug** — Status, health, model snapshots, event log, and manual RPC calls.
- **Update** — Run package updates and restart the gateway.

For more details, please see the official [OpenClaw documentation](https://docs.openclaw.ai/web/control-ui).

{% callout type="warning" %}
Do not use the **Update** feature in the Control UI to update KiloClaw. Use **Redeploy** from the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#redeploy) instead. Updating via the Control UI will not apply the correct KiloClaw platform image and may break your instance.
{% /callout %}

## Authentication

Auth is handled via token or password on the WebSocket handshake. Remote connections require one-time device pairing — the pairing request appears on the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#pairing-requests) or in the Control UI itself.

---

## Changing Models

<!-- source: pages/kiloclaw/control-ui/changing-models.md -->

# Changing Models

The Control UI Chat tab doubles as a command line for model management. KiloClaw exposes 335+ models through the `kilocode` provider and you can browse and switch between them without leaving the chat.

| Command | Description |
|---|---|
| `/model status` | View the currently active model and provider |
| `/models kilocode` | Browse available models (paginated, 20 per page) |
| `/models kilocode <page>` | Jump to a specific page (e.g. `/models kilocode 2`) |
| `/model kilocode/<provider>/<model>` | Switch to a specific model (e.g. `/model kilocode/anthropic/claude-sonnet-4.6`) |
| `/models kilocode all` | List every available model at once |

Each `/models` response includes helper text at the bottom with shortcuts for switching, paging, and listing all models.

To change the default model for all new sessions, edit `agents.defaults.model.primary` in your `openclaw.json` via **Config** in the Control UI (or the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#changing-the-model) for a quick dropdown pick).

For the full list of providers, advanced configuration, and CLI commands, see the [OpenClaw Model Providers documentation](https://docs.openclaw.ai/providers).

---

## Exec Approvals

<!-- source: pages/kiloclaw/control-ui/exec-approvals.md -->

# Exec Approvals

Exec approvals are the safety interlock that controls which commands your agent can run on the host machine (gateway or node). By default, **all host exec requests are denied** — you must explicitly allowlist the commands you want your agent to run independently. This prevents accidental execution of destructive commands.

{% callout type="warning" %}
The default security policy is `deny`. You must configure an allowlist before your agent can execute any host commands.
{% /callout %}

## How It Works

Approvals are enforced locally on the execution host and sit on top of tool policy and elevated gating. The effective policy is always the **stricter** of `tools.exec.*` and the approvals defaults. Settings are stored in `~/.openclaw/exec-approvals.json` on the host.

## Security Policies

| Policy | Behavior |
|---|---|
| `deny` | Block all host exec requests (default) |
| `allowlist` | Allow only commands matching the allowlist |
| `full` | Allow everything (equivalent to elevated mode) |

## Allow Everything from Settings

If you want to skip per-command approvals entirely, you can set the security policy to **Allow Everything** directly from the [KiloClaw Settings dashboard](https://app.kilo.ai/claw/settings). This applies the `full` policy globally, allowing your agent to execute any host command without prompts — equivalent to elevated mode.

{% callout type="warning" %}
Enabling **Allow Everything** removes all exec safety checks. Only use this in trusted environments where you are comfortable with your agent running arbitrary commands.
{% /callout %}

{% image src="/docs/img/kiloclaw/allow-everything-settings.png" alt="Allow Everything setting in KiloClaw Settings Dashboard" width="800" caption="The Allow Everything toggle in KiloClaw Settings" /%}

## Ask Behavior

The `ask` setting controls when the user is prompted for approval:

| Setting | Behavior |
|---|---|
| `off` | Never prompt |
| `on-miss` | Prompt only when the allowlist does not match (default) |
| `always` | Prompt on every command |

If a prompt is required but no UI is reachable, the `askFallback` setting decides the outcome (`deny` by default).

## Allowlists

Allowlists are **per agent** — each agent has its own set of allowed command patterns. Patterns are case-insensitive globs that must resolve to binary paths (basename-only entries are ignored).

Example patterns:

```
~/Projects/**/bin/rg
~/.local/bin/*
/opt/homebrew/bin/rg
```

Each entry tracks last-used metadata (timestamp, command, resolved path) so you can audit and keep the list tidy.

## Approval Flow

When a command requires approval, the gateway broadcasts the request to connected operator clients. The approval dialog shows the command, arguments, working directory, agent ID, and resolved path. You can:

- **Allow once** — run the command now
- **Allow always** — add to the allowlist and run
- **Deny** — block the request

Approval prompts can also be forwarded to chat channels (Slack, Telegram, Discord, etc.) and resolved with `/approve`.

## Editing in the Control UI

Navigate to **Nodes > Exec Approvals** in the Control UI to edit defaults, per-agent overrides, and allowlists. Select a scope (Defaults or a specific agent), adjust the policy, add or remove allowlist patterns, then save.

---

## Version Pinning

<!-- source: pages/kiloclaw/control-ui/version-pinning.md -->

# Version Pinning

Version pinning lets you lock your KiloClaw instance to a specific OpenClaw version and variant. This gives you control over when your instance upgrades — it stays on the pinned version until you explicitly change it.

## When to Use Version Pinning

Version pinning is useful when:

- A changelog entry is marked **Redeploy Required** and you're not ready to upgrade yet
- You're running a workflow that depends on specific OpenClaw behavior
- You want to test the impact of an upgrade before committing to it

## How to Pin a Version

1. Go to your [KiloClaw dashboard](https://app.kilo.ai/profile)
2. Open the **Settings** tab
3. Scroll to the **Version Pinning** section
4. Select a **version** and **variant** from the dropdowns
5. Click **Save**

Your instance will stay on the selected version until you change or clear the pin.

{% callout type="info" %}
After saving a version pin, you need to **Redeploy** for the change to take effect on your running instance.
{% /callout %}

## Variants

Each OpenClaw version is available in one or more variants. Variants may differ in included tools, default configuration, or base image. Select the variant that matches your use case, or use the default if unsure.

## Clearing a Pin

To return to automatic updates:

1. Go to **Settings > Version Pinning**
2. Clear the version selection
3. Click **Save**
4. Use **Upgrade & Redeploy** from the dashboard to apply the latest platform version

{% callout type="warning" %}
Clearing a pin and running **Upgrade & Redeploy** will update your instance to the latest supported platform version. Review the changelog before upgrading to check for breaking changes.
{% /callout %}

---

## Chat Platforms

<!-- source: pages/kiloclaw/chat-platforms/index.md -->

# Chat Platforms

KiloClaw includes Kilo Chat as its first-party channel and also supports connecting your AI agent to messaging platforms so it can receive instructions and send responses directly in your chat apps. You can configure third-party channels from the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard#channels), or from the OpenClaw Control UI after accessing your instance.

## Kilo Chat

Kilo Chat is the zero-setup, first-party channel for KiloClaw. It is enabled by default, does not require a per-sandbox channel token, and is available from the Kilo web and mobile apps as well as supported Kilo Code editor and TUI surfaces.

Use Kilo Chat when you want to talk to your Claw without configuring a separate bot or app in another messaging platform. For external team chat tools, use one of the third-party channels below.

## Third-Party Platforms

The general steps to connect a third-party chat platform are:

1. Configure the channel token in Settings
2. Redeploy the KiloClaw instance
3. Initiate the pairing in the chat app
4. Accept the pairing request in the [KiloClaw UI](https://app.kilo.ai/claw)

## Supported Platforms

- [**Kilo Chat**](https://app.kilo.ai) — Use the built-in first-party channel with no token setup.
- [**Telegram**](/docs/kiloclaw/chat-platforms/telegram) — Connect via a BotFather bot token.
- [**Discord**](/docs/kiloclaw/chat-platforms/discord) — Connect via a Discord Developer Portal bot token.
- [**Slack**](/docs/kiloclaw/chat-platforms/slack) — Connect via a Slack app manifest with app-level and bot tokens.

---

## Telegram

<!-- source: pages/kiloclaw/chat-platforms/telegram.md -->

# Telegram

This page covers everything you need to use KiloClaw with Telegram: connecting your bot and adding it to group chats.

## Connecting KiloClaw to Telegram

{% youtube url="https://youtu.be/hIfKz073hGw" title="Telegram Setup Guide" caption="How to connect your KiloClaw agent to Telegram" /%}

Create a bot via BotFather and link it to your KiloClaw dashboard.

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to create your bot
3. Copy the **Bot Token** that BotFather gives you
4. Go to the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard)
5. Paste the token into the **Telegram Bot Token** field
6. Click **Save**
7. Redeploy your KiloClaw instance
8. Send a direct message to your bot in Telegram: `/start`

{% image src="/docs/img/kiloclaw/telegram.png" alt="Connect account screen" width="800" caption="Telegram bot token entry" /%}

You can remove or replace a configured token at any time.

## Adding KiloClaw to a Telegram Group Chat

By default, KiloClaw will not participate in a group chat, even if added. If you would like to use your KiloClaw in a group chat, you must configure the KiloClaw settings.

### Step 1: Add the bot to your group

1. Open the Telegram group where you want to add your bot
2. Tap the group name at the top to open group info
3. Tap **Add Members**
4. Search for your bot's username and add it

### Step 2: Set group visibility (Privacy Mode)

By default, Telegram bots only see messages that directly mention them. To allow your bot to see all group messages:

1. Open a chat with [@BotFather](https://t.me/BotFather)
2. Send `/setprivacy` and select your bot
3. Choose **Disable**
4. Remove the bot from the group and re-add it for the change to take effect

### Step 3: Get the group chat ID

You need the group's chat ID to configure access. Use one of these methods:

- Forward a message from the group to [@userinfobot](https://t.me/userinfobot) — it will show the chat ID
- Or run `openclaw logs --follow` after sending a message in the group and read the `chat.id` value

Group and supergroup IDs are negative numbers (e.g. `-1001234567890`).

### Step 4: Configure the group in OpenClaw

Tell your KiloClaw bot to add the group to its configuration. You can do this via DM:

> "Add Telegram group `-1001234567890` to my allowed groups. Require a @mention to respond."

Or configure it directly in the OpenClaw Control UI config:

```json
{
  "channels": {
    "telegram": {
      "groupPolicy": "allowlist",
      "groups": {
        "-1001234567890": {
          "requireMention": true
        }
      }
    }
  }
}
```

Set `requireMention: false` if you want the bot to respond to every message in the group without needing to be @mentioned.

{% callout type="tip" %}
To restrict which group members can trigger the bot, add your user IDs to `allowFrom` inside the group config. See the [OpenClaw groups documentation](https://docs.openclaw.ai/channels/groups) for advanced access control patterns.
{% /callout %}

---

## Discord

<!-- source: pages/kiloclaw/chat-platforms/discord.md -->

# Discord

This page covers everything you need to use KiloClaw with Discord: connecting your bot, controlling who can DM it, and adding it to specific channels.

## Connecting KiloClaw to Discord

Create a bot in the Discord Developer Portal and link it to your KiloClaw dashboard.

## Prerequisites

Make sure you have a Discord server ready to add the bot to. If you don't have one, open Discord, scroll to the bottom of your server list, click **+**, choose **Create My Own**, then **For me and my friends**, and give it a name.

## Create an Application and Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and log in
2. Click **New Application**, give it a name, and click **Create**

## Enable Privileged Intents

On the **Bot** page, scroll down to **Privileged Gateway Intents** and enable:

- **Message Content Intent** (required)
- **Server Members Intent** (recommended — needed for role allowlists and name matching)
- **Presence Intent** (optional)

## Generate an Invite URL and Add the Bot to Your Server

1. Click **OAuth2** on the sidebar
2. Scroll down to **OAuth2 URL Generator** and enable:
   - `bot`
   - `applications.commands`
3. A **Bot Permissions** section will appear below. Enable:
   - View Channels
   - Send Messages
   - Read Message History
   - Embed Links
   - Attach Files
   - Add Reactions (optional)
4. Copy the generated URL at the bottom
5. Paste it into your browser, select your server, and click **Continue**
6. You should now see your bot in the Discord server

## Copy Your Bot Token

1. Go back to the **Bot** page on the left sidebar and click **Reset Token**

> 📝 **Note**
> Despite the name, this generates your first token — nothing is being "reset."

2. Copy the token that appears and paste it into the **Discord Bot Token** field in your KiloClaw dashboard.

{% image src="/docs/img/kiloclaw/discord.png" alt="Connect account screen" width="800" caption="Discord bot token entry" /%}

Enter the token in the Settings tab and click **Save**. You can remove or replace a configured token at any time.

## Redeploy to Apply Changes

After saving your token, click **Redeploy** (the yellow button at the top of the KiloClaw dashboard) to apply the changes. The server will restart in about 30–45 seconds. Wait for the redeploy to complete before pairing.

## Start Chatting with the Bot

1. Right-click on the Bot in Discord and click **Message**
2. DM the bot `/pair`
3. You should get a response back with a pairing code
4. Return to [app.kilo.ai/claw](https://app.kilo.ai/claw) and confirm the pairing code and approve
5. You should now be able to chat with the bot from Discord

## Restricting KiloClaw to DMs Only (Just You)

By default, KiloClaw will respond to any DMs. To lock it down to only DMs with you:

### Step 1: Find your Discord user ID

1. In Discord, go to **User Settings** → **Advanced** → enable **Developer Mode**
2. Right-click your own avatar or username → **Copy User ID**

Your user ID is a large number (e.g. `987654321098765432`).

### Step 2: Configure DM-only access

Tell your KiloClaw agent (via DM):

> "Set Discord DM policy to allowlist with my user ID `987654321098765432` and disable guild responses."

Or configure it directly in the OpenClaw Control UI config:

```json
{
  "channels": {
    "discord": {
      "dmPolicy": "allowlist",
      "allowFrom": ["987654321098765432"],
      "groupPolicy": "disabled"
    }
  }
}
```

## Adding KiloClaw to a Specific Discord Channel

By default, your KiloClaw will not respond in channels, even if added. To have KiloClaw participate in a specific channel:

### Step 1: Get your server and channel IDs

With Developer Mode enabled (User Settings → Advanced → Developer Mode):

- Right-click the **server icon** → **Copy Server ID**
- Right-click the **channel name** in the sidebar → **Copy Channel ID**

### Step 2: Configure the channel

Tell your KiloClaw agent:

> "Add Discord server `YOUR_SERVER_ID` and channel `YOUR_CHANNEL_ID` to the allowlist. Only respond to user `YOUR_USER_ID`."

Or configure it directly:

```json
{
  "channels": {
    "discord": {
      "groupPolicy": "allowlist",
      "guilds": {
        "YOUR_SERVER_ID": {
          "requireMention": true,
          "users": ["YOUR_USER_ID"],
          "channels": {
            "YOUR_CHANNEL_ID": { "allow": true }
          }
        }
      }
    }
  }
}
```

Set `requireMention: false` if you want the bot to respond to every message without needing an @mention.

{% callout type="tip" %}
Non-listed channels in a guild that has a `channels` block configured are automatically denied. Add each channel you want explicitly. See the [OpenClaw Discord documentation](https://docs.openclaw.ai/channels/discord) for advanced access control options.
{% /callout %}

---

## Slack

<!-- source: pages/kiloclaw/chat-platforms/slack.md -->

# Slack

This page covers everything you need to use KiloClaw with Slack: connecting your bot, controlling who can DM it, and adding it to channels.

## Connecting KiloClaw to Slack

{% youtube url="https://youtu.be/Q5bt-qH-_pY" title="Slack Setup Guide" caption="How to connect your KiloClaw agent to Slack" /%}

Create a Slack app from the OpenClaw manifest and link it to your KiloClaw dashboard.

### Step 1: Create a Slack App from the OpenClaw Manifest

1. Go to [Slack App Management](https://api.slack.com/apps) and click **Create New App** → **From a Manifest**
2. Copy the manifest from the [OpenClaw docs](https://docs.openclaw.ai/channels/slack#manifest-and-scope-checklist)
3. Paste the manifest JSON into Slack's manifest editor
4. Customize the manifest before creating:
   - Rename the app to your preferred name wherever it appears
   - Update the slash command if desired (e.g., `/kiloclaw`)
5. Click **Create**

### Step 2: Generate Tokens

You need two tokens from Slack:

**App-Level Token**

1. In your Slack app settings, scroll down to **App-Level Tokens**
2. Click **Generate Token**
3. Add the `connections:write` scope
4. Generate and copy the token (starts with `xapp-`)

**Bot User OAuth Token**

1. In the left sidebar, click **Install App**
2. Install the app to your workspace
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Step 3: Connect Slack to KiloClaw

1. In the [KiloClaw UI](https://app.kilo.ai/claw), find the Slack integration section (may show "not configured")
2. Enter both tokens:
   - The `xapp-` app-level token
   - The `xoxb-` bot user OAuth token
3. Click **Save**
4. Scroll to the top of the KiloClaw UI and click **Redeploy**. Wait for the instance to come back up

### Step 4: Pair Slack with KiloClaw

1. In Slack, DM the app and send any message — this triggers the pairing flow
2. The app will return a pairing code
3. Return to [app.kilo.ai/claw](https://app.kilo.ai/claw) and confirm the pairing code and approve
4. You should now be able to DM the bot from Slack. You will need to add the bot to any individual channels and tell it to update its config for any channels you want it to participate in.

## Changing Response Behavior

By default, KiloClaw can respond to any DMs and will not respond in Slack channels, even if added.

## Making KiloClaw DM-Only (from you)

By default, KiloClaw will respond to DMs from any user in Slack.

### Step 1: Find your Slack user ID

1. In Slack, click your name or profile picture
2. Click **Profile**
3. Click the **More** (⋯) menu → **Copy member ID**

Your user ID starts with `U` (e.g. `U12345678`).

### Step 2: Configure DM-only access

Tell your KiloClaw agent:

> "Set my Slack DM policy to allowlist with my user ID `U12345678` and disable group/channel responses."

Or configure it directly in the OpenClaw Control UI config:

```json
{
  "channels": {
    "slack": {
      "dmPolicy": "allowlist",
      "allowFrom": ["U12345678"],
      "groupPolicy": "disabled"
    }
  }
}
```

This allows only your user ID to DM the bot and blocks it from responding in any channels.

## Adding KiloClaw to a Slack Channel

By default, KiloClaw will not respond in Slack channels, even if added. To have KiloClaw participate in a Slack channel:

### Step 1: Invite the bot to the channel

1. Open the Slack channel where you want to add the bot
2. Type `/invite @YourBotName` (use whatever name you gave your app)
3. The bot should appear in the channel member list

### Step 2: Get the channel ID

Channel IDs are more reliable than names. To find a channel's ID:

1. Open the channel in Slack
2. Click the channel name at the top to open channel details
3. Scroll to the bottom — the channel ID starts with `C` (e.g. `C01234567`)

### Step 3: Configure the channel

Tell your KiloClaw agent (via DM):

> "Allow responses in Slack channel `C01234567`. Require an @mention to respond."

Or configure it directly:

```json
{
  "channels": {
    "slack": {
      "groupPolicy": "allowlist",
      "channels": {
        "C01234567": {
          "requireMention": true
        }
      }
    }
  }
}
```

Set `requireMention: false` if you want the bot to respond to every message in the channel without needing an @mention.

{% callout type="tip" %}
You can restrict which channel members can trigger the bot by adding a `users` allowlist inside the channel config entry. See the [OpenClaw Slack documentation](https://docs.openclaw.ai/channels/slack) for advanced access control options.
{% /callout %}

---

## Integrations

<!-- source: pages/kiloclaw/development-tools/index.md -->

# Integrations

Configure integrations and settings for your KiloClaw agent. Connect third-party services to give your agent access to repositories, issue trackers, calendars, documents, and hundreds of other tools — all without manual intervention.

## Available Integrations

- [**GitHub**](/docs/kiloclaw/development-tools/github) — Clone repositories, push commits, open pull requests, and leave code reviews.
- [**Google Workspace**](/docs/kiloclaw/development-tools/google) — Access Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, and more.
- [**Linear**](/docs/kiloclaw/development-tools/linear) — Create and update issues, read projects, and track work in Linear.
- [**Composio**](/docs/kiloclaw/development-tools/composio) — Access 250+ tool integrations through a single connection.
- [**1Password**](/docs/kiloclaw/tools/1password) — Securely manage credentials and let your agent fetch API keys or passwords without ever seeing them in plain text.
- [**Brave Search**](/docs/kiloclaw/tools/brave-search) — Equip your agent with real-time web browsing via the Brave Search API.
- [**AgentCard**](/docs/kiloclaw/tools/agentcard) — Enable your agent to perform financial transactions using virtual debit cards.
- [**Setting Up Other Tools**](/docs/kiloclaw/tools/other-tools) — Configure your agent to use any third-party tool with a CLI or API.

---

## GitHub Integration

<!-- source: pages/kiloclaw/development-tools/github.md -->

# GitHub Integration

Connect a GitHub account to your KiloClaw agent so it can clone repositories, push commits, open pull requests, and leave code reviews — all autonomously.

{% callout type="warning" title="Security" %}
Create a dedicated GitHub account for your bot rather than using your personal account. This limits the blast radius if credentials are compromised, provides clear audit trails of agent activity, and lets you scope permissions to only what the agent needs.
{% /callout %}

## Setup

### Step 1: Prepare a GitHub account for your bot

If you don't already have a dedicated GitHub account for your bot, create one first:

1. Go to [github.com/signup](https://github.com/signup) and create a new account using a bot specific email address
2. Verify the email address
3. Enable two factor authentication at [github.com/settings/security](https://github.com/settings/security) (GitHub requires this for PAT creation)

Once you have a GitHub account ready, continue to Step 2.

### Step 2: Generate a Personal Access Token

KiloClaw uses a [fine grained Personal Access Token](https://github.com/settings/tokens?type=beta) to authenticate as your bot. When creating the token, use these settings:

| Setting | Recommended Value |
|---|---|
| **Token name** | `kiloclaw-bot` (or any descriptive name) |
| **Expiration** | 90 days (set a reminder to rotate) |
| **Repository access** | All repositories, or select specific ones |

Grant the following permissions:

| Permission | Access Level | Purpose |
|---|---|---|
| **Contents** | Read & Write | Clone repos, push commits |
| **Pull requests** | Read & Write | Open and manage pull requests |
| **Issues** | Read & Write | Create and comment on issues |
| **Metadata** | Read only | List repositories and basic repo info |
| **Workflows** | Read & Write | Trigger and manage GitHub Actions workflows |

### Step 3: Enter credentials in KiloClaw

1. Go to the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard)
2. Scroll to the **Tools** section
3. Enter the **Personal Access Token**, **Username**, and **Email** for the bot account
4. Click **Save**
5. **Redeploy** your instance to apply the changes

## Token Formats

KiloClaw accepts both GitHub token formats:

- **Classic tokens** — Start with `ghp_` (e.g., `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
- **Fine grained tokens** — Start with `github_pat_` (e.g., `github_pat_xxxxxxxxxxxxxxxxxxxxxx`)

Fine grained tokens are recommended as they provide more granular permission control.

## How It Works

When your instance starts, KiloClaw automatically:

1. Authenticates the GitHub CLI (`gh`) with your token
2. Configures `git` with the bot's username and email for commits
3. Makes both `gh` and `git` commands available to the agent

The agent can then use standard Git and GitHub CLI commands to interact with your repositories.

## Security

- Tokens are encrypted at rest using KiloClaw's secret management system
- Credentials are only decrypted inside your running instance
- Use short lived tokens and rotate them periodically — 30 to 90 days is a good range
- Use fine grained personal access tokens so you can scope access to specific repositories and only the permissions the agent actually needs
- GitHub allows you to edit an existing token to add more permissions later, so you can start with the minimum permissions you need and expand as required

## Related

- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)
- [Connecting Chat Platforms](/docs/kiloclaw/chat-platforms)
- [Pre-installed Software](/docs/kiloclaw/pre-installed-software)

---

## Google Workspace Integration

<!-- source: pages/kiloclaw/development-tools/google.md -->

# Google Workspace Integration

Connect a dedicated Google account to KiloClaw so it can interact with Google Workspace services — Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, People, Forms, Chat, Classroom, and Apps Script.

{% callout type="warning" title="Use a dedicated Google account" %}
We recommend creating a **dedicated Google account** for KiloClaw. This keeps your personal data separate and gives you full control over what KiloClaw can access.

If you are using Google Workspace, we recommend creating the bot account inside the Google Workspace.
{% /callout %}

## What You Get

Once setup is complete, your KiloClaw machine will have the following configured automatically:

- The [`gog` CLI](/docs/kiloclaw/pre-installed-software) pre-loaded with the KiloClaw Google account's credentials, giving the agent access to 12+ Google APIs
- Real-time Gmail push notifications via Google Pub/Sub, so KiloClaw can react to incoming emails sent to the dedicated account without polling
- Access to the full range of Google Workspace services:

| Service | What KiloClaw can do |
|---|---|
| **Gmail** | Read, draft, and send emails |
| **Google Calendar** | View and manage events |
| **Google Drive** | Access and organize files |
| **Google Docs** | Read and edit documents |
| **Google Sheets** | Read and edit spreadsheets |
| **Google Slides** | Read and edit presentations |
| **Google Tasks** | View and manage tasks |
| **People (Contacts)** | Access contact information |
| **Google Forms** | Read and manage forms |
| **Google Chat** | Send and read messages |
| **Google Classroom** | Access classroom resources |
| **Apps Script** | Manage Apps Script projects |

## Prerequisites

Before you begin, make sure you have:

- **Docker** installed and running on your machine

## Setup

{% youtube url="https://youtu.be/PX444_j3O4I" title="Google Workspace Setup Guide" caption="How to connect your Google account to KiloClaw" /%}

1. Go to the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard)
2. Find the **Google Account** section
3. Copy the provided `docker run` command — it includes a short-lived authentication token
4. Paste the command into a terminal on your local machine and run it

The container launches an interactive setup flow. Follow the on-screen prompts — you will need to switch to a web browser at several points during the process.

## Using Google Services

Once setup is complete, KiloClaw can interact with Google Workspace services using the dedicated account. You can issue natural language prompts directly. For example:

- "Check your Gmail inbox for unread messages"
- "Create a new Google Doc summarizing our meeting notes"
- "Add a meeting to your calendar for tomorrow at 2pm"
- "List recent files in your Google Drive"

KiloClaw will automatically use the dedicated account's credentials to fulfill these requests.

### Accessing your personal Google data

KiloClaw's credentials are tied to its dedicated Google account — not your personal one. To let KiloClaw work with your personal Google data, you need to **share or delegate access from your personal account to the KiloClaw account**:

| Service | How to share access |
|---|---|
| **Google Calendar** | Share your calendar with the KiloClaw account's email address ([instructions](https://support.google.com/calendar/answer/37082)) |
| **Google Drive** | Share specific files or folders with the KiloClaw account's email address |
| **Gmail** (Option 1: Delegation) | Set up [Gmail delegation](https://support.google.com/mail/answer/138350) to grant KiloClaw read and write access to your inbox — it can read, draft, and send emails on your behalf |
| **Gmail** (Option 2: Forwarding) | Set up [email forwarding](https://support.google.com/mail/answer/10957) so KiloClaw receives its own copy of all incoming emails — it can read them but cannot make any changes to your original inbox |
| **Google Docs / Sheets / Slides** | Share individual documents with the KiloClaw account's email address |

Once access is shared, reference the delegation in your prompts so KiloClaw knows where to look:

- "Check the shared calendar from alice@example.com for tomorrow's meetings"
- "Open the Q3 report shared with you from the team Drive"
- "Read the latest emails in the delegated inbox from alice@example.com"
- "Draft a reply in the delegated Gmail from alice@example.com to the last message from Bob"

## Related

- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)
- [GitHub Integration](/docs/kiloclaw/development-tools/github)
- [Pre-installed Software](/docs/kiloclaw/pre-installed-software)
- [Chat Platforms](/docs/kiloclaw/chat-platforms)

---

## Linear Integration

<!-- source: pages/kiloclaw/development-tools/linear.md -->

# Linear Integration

Connect Linear to your KiloClaw agent so it can create issues, update their status, read project backlogs, and track work — all automatically. Linear is a project management tool popular with software teams for planning and tracking features, bugs, and tasks.

{% callout type="warning" title="Keep your API key private" %}
Your Linear API key grants access to your workspace. Never share it publicly or commit it to a repository. If a key is ever exposed, revoke it immediately from your Linear account settings and generate a new one.
{% /callout %}

## Prerequisites

Before you begin, make sure you have:

- A **Linear account** with access to the workspace you want KiloClaw to use
- A **KiloClaw agent** already set up — see the [Dashboard Reference](/docs/kiloclaw/dashboard) if you haven't done this yet

## Setup

### Step 1: Generate a Linear API key

1. Log in to your Linear account at [linear.app](https://linear.app)
2. Click your workspace name in the top-left corner and select **Settings**
3. In the left sidebar, go to **Account** → **API**
4. Click **Create key**
5. Give the key a descriptive label (for example, `kiloclaw-bot`) and click **Create**
6. Copy the key — you will only see it once

### Step 2: Add the API key to KiloClaw

1. Go to the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard)
2. Scroll to the **Integrations** section and find **Linear**
3. Paste the API key into the **Linear API Key** field
4. Click **Save**
5. **Redeploy** your instance to apply the changes

### Step 3: Verify the connection

Once your instance has redeployed, send your agent a prompt to check that Linear is working. For example:

- "List the open issues assigned to me in Linear"
- "What projects are in my Linear workspace?"

If the agent returns results from your workspace, the connection is working correctly.

## What Your Agent Can Do

Once connected, your KiloClaw agent can interact with Linear on your behalf:

| Action | Example prompt |
|---|---|
| Create an issue | "Create a Linear issue titled 'Fix login bug' in the Engineering project" |
| Update an issue | "Mark the Linear issue LIN-42 as In Progress" |
| Read issues | "Show me all open bugs assigned to the team this week" |
| Search projects | "What issues are in the Backend project?" |
| Add comments | "Add a comment to LIN-100 saying the fix has been deployed" |

## Related

- [Integrations Overview](/docs/kiloclaw/development-tools)
- [GitHub Integration](/docs/kiloclaw/development-tools/github)

---

## Composio Integration

<!-- source: pages/kiloclaw/development-tools/composio.md -->

# Composio Integration

Connect Composio to your KiloClaw agent to instantly unlock access to 250+ tool integrations — from Salesforce and HubSpot to Notion, Jira, and beyond. Composio is a platform that handles the authentication and connection details for each service, so your agent can use them without you having to set up each one individually.

{% callout type="info" title="Tip" %}
Browse the full list of toolkits Composio supports at [composio.dev/toolkits](https://composio.dev/toolkits). If a toolkit you need is listed there, you can connect it to KiloClaw through Composio in minutes.
{% /callout %}

## Prerequisites

Before you begin, make sure you have:

- A **Composio account** — sign up for free at [composio.dev](https://composio.dev)
- A **KiloClaw agent** already set up — see the [Dashboard Reference](/docs/kiloclaw/dashboard) if you haven't done this yet

## Setup

### Step 1: Create a Composio account and get your API key

1. Go to [composio.dev](https://composio.dev) and sign up for a free account
2. Once logged in, open the **Settings** or **API Keys** section of your Composio dashboard
3. Click **Create API Key**, give it a name (for example, `kiloclaw`), and copy the key

### Step 2: Add the API key to KiloClaw

1. Go to the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard)
2. Scroll to the **Integrations** section and find **Composio**
3. Paste the API key into the **Composio API Key** field
4. Click **Save**
5. **Redeploy** your instance to apply the changes

### Step 3: Authenticate tools in Composio

Composio acts as a bridge between KiloClaw and each third-party service. To allow your agent to use a specific tool, you need to authorise it once inside Composio:

1. In your Composio dashboard, go to **Integrations** or **Connected Accounts**
2. Find the tool you want (for example, Slack, Notion, or Jira)
3. Click **Connect** and follow the authentication steps for that service
4. Once connected, the tool is immediately available to your KiloClaw agent

Repeat this for each service your agent needs to access.

## What Your Agent Can Do

Once connected, your KiloClaw agent can use any tool you have authenticated in Composio. With 250+ integrations available, this includes:

| Category | Example tools |
|---|---|
| **Project management** | Jira, Notion, Asana, Trello, ClickUp |
| **Communication** | Slack, Discord, Microsoft Teams |
| **Development** | GitHub, GitLab, Bitbucket |
| **CRM & sales** | Salesforce, HubSpot, Pipedrive |
| **Documents & storage** | Google Drive, Dropbox, Confluence |
| **Databases** | Airtable, Supabase, PostgreSQL |

Your agent can perform actions like reading data, creating records, sending messages, and triggering workflows — all through natural language prompts.

## Related

- [Integrations Overview](/docs/kiloclaw/development-tools)
- [GitHub Integration](/docs/kiloclaw/development-tools/github)

---

## Tools

<!-- source: pages/kiloclaw/tools/index.md -->

# Tools

KiloClaw supports integrations with third-party tools that extend your agent's capabilities — from secure credential management to web search and financial transactions.

## Available Integrations

- [**1Password**](/docs/kiloclaw/tools/1password) — Securely manage credentials and let your agent fetch API keys or passwords without ever seeing them in plain text.
- [**Brave Search**](/docs/kiloclaw/tools/brave-search) — Equip your agent with real-time web browsing via the Brave Search API.
- [**AgentCard**](/docs/kiloclaw/tools/agentcard) — Enable your agent to perform financial transactions using virtual debit cards.
- [**Setting Up Other Tools**](/docs/kiloclaw/tools/other-tools) — Configure your agent to use any third-party tool with a CLI or API.

---

## 1Password Integration

<!-- source: pages/kiloclaw/tools/1password.md -->

# 1Password Integration Guide

Connect your KiloClaw agent to 1Password to securely manage credentials. This allows your agent to fetch API keys or passwords without ever seeing them in plain text.

## Step 1: Create a Dedicated Vault

For maximum security, do not give the bot access to your personal vault.

1. Log in to your 1Password account.
2. Create a **New Vault** (e.g., name it `Kilo-Agent-Vault`).
3. Move only the specific items/keys you want the bot to use into this vault.

## Step 2: Generate a Service Account Token

1. Go to the [1Password Developer Portal](https://developer.1password.com/).
2. Select **Service Accounts** and click **Create a Service Account**.
3. **Important:** When prompted for permissions, select only the dedicated vault you created in Step 1.
4. Copy the generated token (it will begin with `ops_`).

## Step 3: Configure KiloClaw

1. Navigate to your KiloClaw dashboard: [app.kilo.ai/claw](https://app.kilo.ai/claw).
2. Go to **Settings > Tools** (or **Edit Files**).
3. Paste your `ops_` token into the **1Password Setup** field.
4. Click **Save**.

## Step 4: Activate the Integration

To apply the changes and inject the 1Password CLI into your environment:

1. Select **Upgrade to latest**.
2. Perform a **Redeploy** to restart the agent with the new permissions active.

---

## Brave Search Integration

<!-- source: pages/kiloclaw/tools/brave-search.md -->

# Brave Search Integration

Equip your KiloClaw agent with real-time web browsing capabilities by integrating the Brave Search API. This allows the agent to fetch up-to-date information, perform market research, and verify facts beyond its training data.

## How to Generate a Brave Search API Key

To get started, you will need to obtain a "BSA" (Brave Search API) key from the Brave developer portal.

### 1. Access the Brave Search Dashboard

Go to [api.search.brave.com](https://api.search.brave.com) and sign in or create a developer account.

### 2. Choose a Subscription Plan

Brave Search API requires a paid subscription. Select the plan that fits your usage volume.

### 3. Create an API Key

Once your account is active, navigate to the **API Keys** section and click **"Create New Key."**

### 4. Copy the Key

Your key will typically begin with the prefix `BSA`. Copy this key immediately, as it may not be displayed again for security reasons.

---

## AgentCard Integration

<!-- source: pages/kiloclaw/tools/agentcard.md -->

# AgentCard Integration

Enable your KiloClaw agents to perform financial transactions by creating and managing virtual debit cards. This integration allows for automated purchasing and expense management within set limits.

## AgentCard Setup

### 1. Create an AgentCard Account

Install the AgentCard CLI and sign up via your terminal:

```bash
agent-cards signup
```

### 2. Add a Payment Method

Link your funding source (via Stripe) to enable the creation of virtual cards:

```bash
agent-cards payment-method
```

### 3. Retrieve Your API Key

Open your local configuration file located at `~/.agent-cards/config.json`. Copy the value assigned to the `jwt` key.

### 4. Configure KiloClaw

1. Paste the **JWT** into the AgentCard setup field in your KiloClaw settings.
2. Click **Save**.
3. Use **Redeploy** to apply the new secret. Only use **Upgrade & Redeploy** if you also need the latest platform version.

## Available Tools

Once activated, your agent will have access to:

- `create_card`: Generate a new virtual debit card.
- `list_cards`: View existing cards and their statuses.
- `check_balance`: Monitor available funds.

---

## Setting Up Other Services

<!-- source: pages/kiloclaw/tools/other-tools.md -->

# Setting Up Other Services

While KiloClaw comes with a set of [pre-configured tool integrations](/docs/kiloclaw/tools), your agent isn't limited to just those. KiloClaw can be configured to use virtually any third-party integration as a tool — as long as it has a CLI or an API, you can teach your agent to work with it.

We have seen this pattern work well with outside services like ZenDesk, Todoist, GitLab, and more.

## If There Is a CLI

When the tool you want to integrate provides a command-line interface, follow these steps:

1. Tell KiloClaw to install the CLI.

2. Add a key, PAT, or token to the KiloClaw's [1Password](/docs/kiloclaw/tools/1password).

3. Navigate to the KiloClaw Dashboard (`app.kilo.ai/claw/settings`) > *Danger Zone* > *Edit Files* > `workspace` folder > `TOOLS.md`, and add the following to the bottom of the file:

>   TOOL is 1 SENTENCE DESCRIPTION. You have access to it via the CLI NAME CLI. The username and password are in the 1Password vault under TOOL.

4. Ask the agent to perform a task using the tool.

## If There Is No CLI, but There Is an API

When the tool only provides an API (no CLI), follow these steps:

1. Add a key, PAT, or token to the KiloClaw's [1Password](/docs/kiloclaw/tools/1password).

2. Navigate to the KiloClaw Dashboard (`app.kilo.ai/claw/settings`) > *Danger Zone* > *Edit Files* > `workspace` folder > `TOOLS.md`, and add the following to the bottom of the file:

>   TOOL is 1 SENTENCE DESCRIPTION. You have access to it via the API. API documentation is at URL OF API DOCUMENTATION. Credentials are in 1Password under TOOL NAME.

1. Ask the agent to use the API.

{% callout type="note" %}
If you have not configured your KiloClaw with the 1Password CLI, you can add the username in `TOOLS.md` and the key as an *Additional Secret* in the [KiloClaw Dashboard](https://app.kilo.ai/claw/settings) with the config path `skills.entries.<TOOL_NAME>.apiKey` and environment variable name `<TOOL_NAME>_API_KEY`.
{% /callout %}

## Improving performance

The instructions above will get your KiloClaw started with using the tool, but it will have to read the documentation every time and may fumble to use the CLI or API in question. 

As you use the CLI or API, instruct KiloClaw to do the following to make usage more reliable and less token-intensive:

* Save usage patterns to `TOOLS.md`
* Extract usage patterns into a skill
* Write a python or javascript wrapper for the CLI or API to encompass the ways you tend to use it

---

## Triggers

<!-- source: pages/kiloclaw/triggers/index.md -->

# Triggers

Triggers let external events and schedules drive your KiloClaw agent automatically. Instead of typing every instruction yourself, triggers deliver messages to your agent on your behalf. This lets it react to real-world events or run tasks on a schedule without polling.

All triggers are managed from the **Settings** page in the KiloClaw section of the sidebar.

Webhook triggers and scheduled triggers use the same trigger concepts across
KiloClaw and Cloud Agent, but target different agents. Use KiloClaw triggers when
an HTTP event or schedule should deliver a chat message to a KiloClaw instance.
Use Cloud Agent triggers when the automation should start a Cloud Agent session
against a repository.

## Trigger Types

| Type | Description |
|---|---|
| [**Webhooks**](/docs/kiloclaw/triggers/webhooks) | Receive HTTP requests from external services (GitHub, Stripe, monitoring tools, etc.) and deliver them as chat messages to your agent |
| [**Scheduled**](/docs/kiloclaw/triggers/scheduled) | Run tasks on a recurring schedule (e.g. every 15 minutes, daily at 9 AM, weekdays only) |

## How Triggers Work

1. A trigger fires
2. Your **prompt template** is rendered into a message
3. That message is delivered to your KiloClaw instance as a chat message
4. Your agent processes and responds like any other conversation

Each trigger type has its own set of template variables. See the [Webhooks](/docs/kiloclaw/triggers/webhooks) and [Scheduled](/docs/kiloclaw/triggers/scheduled) pages for details.

{% callout type="warning" title="Triggers send prompts directly to your agent" %}
When a trigger fires, the rendered message is sent directly to your KiloClaw agent as a prompt. If your instance is configured with a permission model that allows all actions, the agent will execute commands automatically without your explicit approval. This means triggers can cause your agent to take actions without you being aware. Review your instance's [permission settings](/docs/kiloclaw/control-ui/exec-approvals) and prompt templates carefully before enabling triggers.
{% /callout %}

## Request History

Trigger activity appears in request history so you can inspect recent webhook and
scheduled invocations. History entries show the source (webhook or scheduled),
status such as captured, in progress, success, or failed, request metadata,
payload details when available, and links or sharing actions for the resulting
session.

## Related

- [Webhooks](/docs/kiloclaw/triggers/webhooks)
- [Scheduled Triggers](/docs/kiloclaw/triggers/scheduled)
- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)

---

## Webhooks

<!-- source: pages/kiloclaw/triggers/webhooks.md -->

# Webhooks

KiloClaw supports inbound webhooks so external events can trigger your agent automatically. Form submissions, alerts, calendar updates, ecommerce orders, IoT sensor data; anything that can send an HTTP request can kick off a conversation with your agent. When a webhook fires, the payload is rendered through a prompt template and delivered as a chat message to your KiloClaw instance. The agent processes and responds as if you typed it yourself.

Webhook triggers are one trigger mode shared by KiloClaw and Cloud Agent. In
KiloClaw, the rendered prompt is delivered to the KiloClaw instance on this page;
in Cloud Agent, the same trigger concept starts a Cloud Agent repository session.

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

---

## Scheduled Triggers

<!-- source: pages/kiloclaw/triggers/scheduled.md -->

# Scheduled Triggers

Scheduled triggers let your KiloClaw agent run tasks automatically on a recurring schedule. Instead of waiting for an external event, a scheduled trigger fires at the times you define using cron expressions. When it fires, the prompt template is rendered and delivered as a chat message to your KiloClaw instance, just like a webhook.

Scheduled triggers are one trigger mode shared by KiloClaw and Cloud Agent. In
KiloClaw, the rendered prompt is delivered to the KiloClaw instance on this page;
in Cloud Agent, the same trigger concept starts a Cloud Agent repository session.

## Setup

1. Go to **Settings** under the KiloClaw section in the sidebar
2. Find the **Scheduled Triggers** section and click **Add Scheduled Trigger**
3. Give your trigger a name (minimum 8 characters)
4. Configure the schedule and prompt template
5. Click **Save**

Each KiloClaw instance supports up to **5 scheduled triggers** alongside its single webhook.

## Configuring a Schedule

The schedule builder defaults to a friendly picker view. For more control, click **<> Advanced** to switch to raw cron input.

### Simple Mode (default)

Pick a frequency, time, and (optionally) days of the week from dropdown menus. The builder generates the cron expression for you behind the scenes and shows a preview of the next 5 upcoming runs.

- **Repeat**: Every 10 minutes, every 15 minutes, every 30 minutes, hourly, daily, weekly
- **At**: Select the time of day (for daily and weekly frequencies)
- **Day of week**: Select which days the trigger should fire (for weekly frequency)

### Advanced Mode

Click **<> Advanced** to enter a raw cron expression directly. This gives you full control over the schedule. The expression is validated in real time with a preview of upcoming fire times.

Cron expressions use the standard five-field format:

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

### Timezone

Select a timezone for your schedule. The default is UTC. All fire times are calculated relative to the selected timezone, including automatic handling of daylight saving time transitions.

## Prompt Template

The prompt template controls what message your agent receives when the schedule fires. You can customize it from the trigger's settings.

**Default template:**

```
Run your scheduled task. Triggered at {{scheduledTime}}.
```

**Available variables:**

| Variable | Description |
|---|---|
| `{{scheduledTime}}` | The time the schedule fired (ISO string) |
| `{{timestamp}}` | Capture timestamp (ISO string) |

{% callout type="note" title="Webhook variables are not available" %}
Since scheduled triggers do not receive an HTTP request, variables like `{{body}}`, `{{bodyJson}}`, `{{headers}}`, `{{method}}`, `{{path}}`, and `{{query}}` are not populated. Use `{{scheduledTime}}` and `{{timestamp}}` instead.
{% /callout %}

## Managing Scheduled Triggers

### Pause and Resume

Toggle the **Active/Paused** switch to temporarily stop a trigger from firing. When paused, the schedule is suspended but the configuration is preserved. Resume at any time to restart the schedule.

### Edit

You can update the cron expression, timezone, and prompt template of an existing scheduled trigger at any time. The activation mode (webhook vs. scheduled) cannot be changed after creation.

### Delete

Remove a scheduled trigger from the inline controls in the Settings panel. A confirmation dialog is shown before deletion.

## Viewing Scheduled Trigger Activity

Scheduled trigger invocations appear in the same request history as webhooks. The **Source** column shows a **Scheduled** badge to distinguish them from webhook-triggered requests. Click into a request to see the scheduled fire time and other details.

## Example: Daily Standup Summary

Create a scheduled trigger that fires every weekday morning and asks your agent to summarize overnight activity:

1. Add a scheduled trigger in your KiloClaw Settings
2. Set the frequency to **Weekly** on **Monday through Friday** at **9:00 AM** in your local timezone
3. Customize the prompt template:

```
Good morning! Please summarize any overnight activity in the #engineering Slack channel and list open pull requests that need review today. Triggered at {{scheduledTime}}.
```

Your agent will receive this message every weekday at 9:00 AM and respond with the summary.

## Related

- [Webhooks](/docs/kiloclaw/triggers/webhooks)
- [Triggers Overview](/docs/kiloclaw/triggers)
- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)

---

## Common Questions

<!-- source: pages/kiloclaw/troubleshooting/common-questions.md -->

# Common Questions

## OpenClaw Doctor

OpenClaw Doctor is the recommended first step when something isn't working. It runs diagnostics on your instance and automatically fixes common configuration issues.

To use it:

1. Make sure your instance is running
2. Click **OpenClaw Doctor** on your [dashboard](/docs/kiloclaw/dashboard)
3. Watch the output as it runs — results appear in real time

## Does Redeploy reset my instance?

No. Redeploy does **not** delete your files, git repos, or cron jobs. It stops the machine, applies the latest platform image and your current configuration, and starts it again with the same persistent storage. Think of it as "update and restart."

## When should I use Restart OpenClaw vs Redeploy?

- **Restart OpenClaw** — Restarts just the OpenClaw process. The machine stays up. Use this for quick recovery from a process-level issue or when you want to apply openclaw config changes.
- **Redeploy** — Stops and restarts the entire machine with the latest image and config. Use this when the changelog shows a redeploy hint, or after changing channel tokens or secrets.

## My bot isn't responding on Telegram/Discord/Slack

1. Check that the channel token is configured in [Settings](/docs/kiloclaw/dashboard#channels)
2. Make sure you **Redeployed** or **Restarted OpenClaw** after saving tokens
3. Check for pending pairing requests — the user may need to be approved
4. Try running **OpenClaw Doctor**

## Accessing and Restoring Config Files

You can directly access the files in `/root/.openclaw/` on the [KiloClaw Dashboard](https://app.kilo.ai/claw) using the file browser of the edit files dialog. This can be a useful way to examine or update the config files (especially `openclaw.json`) if you run into an issue. There may also be backups in the form of `openclaw.bak` files that you can manually restore from if needed.

## The gateway shows "Crashed"

The OpenClaw process is automatically restarted when it crashes. Check the Gateway Process tab on your dashboard for the exit code and restart count. If it keeps crashing:

1. Run **OpenClaw Doctor**
2. Try a **Redeploy** to apply the latest platform image
3. If the issue persists, join the [Kilo Discord](https://kilo.ai/discord) and share details in the KiloClaw channel

## I changed the model but the agent is still using the old one

After selecting a new model, click **Save & Provision** to apply it. This refreshes the API key and saves the new model. You may also need to **Restart OpenClaw** for the change to take full effect.

---

## Gateway Process States

<!-- source: pages/kiloclaw/troubleshooting/gateway-process.md -->

# Gateway Process States

The Gateway Process tab shows the current state of the OpenClaw process inside your machine:

- **Running** — The process is up and handling requests
- **Stopped** — The process is not running
- **Starting** — The process is booting up
- **Stopping** — The process is shutting down gracefully
- **Crashed** — The process exited unexpectedly and will be automatically restarted
- **Shutting Down** — The process is stopping as part of a machine stop or redeploy

---

## Architecture Notes

<!-- source: pages/kiloclaw/troubleshooting/architecture.md -->

# Architecture Notes

For advanced users — how KiloClaw instances are structured:

- **Dedicated machine** — Each user gets their own machine and persistent volume. There is no shared infrastructure between users.
- **Region-pinned storage** — Your persistent volume stays in the region where your instance was originally created.
- **Network isolation** — OpenClaw binds to loopback only; external traffic is proxied through a Kilo controller.
- **Per-user authentication** — The gateway token is derived per-user for authenticating requests to your machine.
- **Encryption at rest** — Sensitive data (API keys, channel tokens) is encrypted at rest in the machine configuration.

---

## FAQ

<!-- source: pages/kiloclaw/troubleshooting/faq.md -->

# FAQ

## How can I change my model?

You can change the model in two ways:

- **From chat** — Type `/model` in the Chat window within the OpenClaw Control UI to switch models directly.
- **From the dashboard** — Go to [https://app.kilo.ai/claw](https://app.kilo.ai/claw), select the model you want, and click **Save**. No redeploy is needed.

## Can I access the filesystem?

You can access instance files in `/root/.openclaw/` directly from the [KiloClaw Dashboard](https://app.kilo.ai/claw). This is useful for examining or restoring config files. You can also interact with files through your OpenClaw agent using its built-in file tools.

## Can I access my KiloClaw via SSH?

For security reasons, SSH access is currently disabled for all KiloClaw instances. Our primary goal is to provide a secure environment for all users, and restricting direct SSH access is one of the many measures we take to ensure the platform remains safe and protected for everyone.

## How can I update my OpenClaw?

Do **not** click **Update Now** inside the OpenClaw Control UI — this is not supported for KiloClaw instances and may break your setup.

Updates are managed by the KiloClaw platform team to ensure stability. When a new version is available, it will be announced in the **Changelog** on your dashboard. To apply the update, click **Upgrade & Redeploy** from the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#redeploy).

---

## FAQ

<!-- source: pages/kiloclaw/faq/general.md -->

# FAQ

## How can I change my model?

You can change the model in two ways:

- **From chat** — Type `/model` in the Chat window within the OpenClaw Control UI to switch models directly.
- **From the dashboard** — Go to [https://app.kilo.ai/claw](https://app.kilo.ai/claw), select the model you want, and click **Save**. No redeploy is needed.

## Can I access the filesystem?

You can access instance files in `/root/.openclaw/` directly from the [KiloClaw Dashboard](https://app.kilo.ai/claw). This is useful for examining or restoring config files. You can also interact with files through your OpenClaw agent using its built-in file tools.

## Can I access my KiloClaw via SSH?

For security reasons, SSH access is currently disabled for all KiloClaw instances. Our primary goal is to provide a secure environment for all users, and restricting direct SSH access is one of the many measures we take to ensure the platform remains safe and protected for everyone.

## How can I update my OpenClaw?

Do **not** click **Update Now** inside the OpenClaw Control UI — this is not supported for KiloClaw instances and may break your setup.

Updates are managed by the KiloClaw platform team to ensure stability. When a new version is available, it will be announced in the **Changelog** on your dashboard. To apply the update, click **Upgrade & Redeploy** from the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#redeploy).

## How do I migrate my OpenClaw?

Whether you're migrating from another OpenClaw provider to KiloClaw, moving between KiloClaw instances (e.g., individual to org or vice versa), or leaving KiloClaw for another OpenClaw provider, you should plan to migrate your workspace, memory, and context so your new Claw retains the same knowledge as before.

You should plan to reconfigure integrations in the new instance as these are often tied to the instance and will break if you attempt migration.

### 1. Back up your workspace

Have your current instance export the workspace. We recommend creating a GitHub repo or `tar` archive file for easy loading.

If you are on KiloClaw, you can use

**GitHub export** — make sure [GitHub is configured](/docs/kiloclaw/development-tools/github) and ask your instance:

> Create a new GitHub repo and push your entire workspace there with the `gh` CLI. Tell me the URL of the repo you used.

**Google Drive** — make sure [Google Drive is configured](/docs/kiloclaw/development-tools/google) and ask your instance:

> Tar compress your workspace and push the file to Google Drive with the `gog` CLI. Then share the filename you used.

### 2. Stand up the new instance

### 3. Reconfigure integrations on the new instance

If you are using GitHub or Google Drive for the migration, prioritize that configuration.

### 4. Restore the workspace on the new instance

On your new Claw, restore the workspace from whichever backup method you used:

**From GitHub:**

> The GitHub repo `<repo>` has a backup of your workspace. Pull the workspace from the repo with the `gh` CLI and overwrite the existing workspace directory with the repo's contents.

**From Google Drive:**

> The Google Drive file `<filename>` has a backup of your workspace. Pull the tar file from Google Drive with the `gog` CLI and overwrite the existing workspace directory with its contents.

{% callout type="note" %}
Replace `<repo>` or `<filename>` with the actual repository URL or filename from the backup step.
{% /callout %}

---

## Pricing

<!-- source: pages/kiloclaw/faq/pricing.md -->

# Pricing

KiloClaw uses Kilo Gateway credits by default — if you route requests through BYOK, model usage is billed directly by your provider instead.

## Instance Hosting

Each user gets a dedicated machine (2 shared vCPUs, 3 GB RAM, 10 GB SSD). Visit [kilo.ai/pricing](https://kilo.ai/pricing) for current pricing and plans.

## Model Inference

Model usage is charged against your [Gateway credit balance](/docs/gateway/usage-and-billing). Costs vary by model — premium models like Claude Opus or GPT-5.4-pro cost more per token than smaller models.

## Free Models

Several models are available at **no additional cost** to your Gateway balance. These are great for getting started or for tasks that don't need the most powerful models.

To see which models are currently free, check the [Kilo Leaderboard](https://kilo.ai/leaderboard#all-models) — free models are marked accordingly.

## Adding Credits

You can add Gateway credits from your [Kilo account](https://app.kilo.ai). Credits are shared across all Kilo products (VSCode extension, CLI, Cloud Agents, and KiloClaw).

See [Adding Credits](/docs/getting-started/adding-credits) and [Gateway Usage and Billing](/docs/gateway/usage-and-billing) for details.

---
