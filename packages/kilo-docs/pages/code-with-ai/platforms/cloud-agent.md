---
title: "Cloud Agent"
description: "Using Kilo Code in the browser"
---

# {% $markdoc.frontmatter.title %}

Cloud Agents let you run Kilo Code in the cloud from any device, without relying on your local machine. They provide a remote development environment that can read and modify your GitHub and GitLab repositories, run commands, and auto-commit changes as work progresses.

## What Cloud Agents Enable

- Run Kilo Code remotely from a browser
- Auto-create branches and push work continuously
- Use env vars + startup commands to shape the workspace
- Work from anywhere while keeping your repo in sync

## Prerequisites

Before using Cloud Agents:

- **GitHub or GitLab Integration must be configured**
  Connect your account via the [Integrations tab](https://app.kilo.ai/integrations) so that Cloud Agents can access your repositories.

## Cost

- **Compute is free during limited beta**
  - Please provide any feedback in our Cloud Agents beta Discord channel: [Kilo Discord](https://kilo.ai/discord)
- **Kilo Code credits are still used** when the agent performs work (model usage, operations, etc.).

## How to Use

1. **Connect your GitHub or GitLab account** in the [Integrations](https://app.kilo.ai/integrations) tab of your personal or organization dashboard.
2. **Select a repository** to use as your workspace.
3. **Add environment variables** (secrets supported) and set optional startup commands.
4. **Start chatting with Kilo Code.**

Your work is always pushed to GitHub, ensuring nothing is lost.

## How Cloud Agents Work

- Each user receives an **isolated Linux container** with common dev tools preinstalled (Node.js, git, gh CLI, glab CLI, etc.).
- Python is not included in the base image, but `apt` is available so you can install it or other packages as needed.
- All Cloud Agent chats share a **single container instance**, while each session gets its own workspace directory.
- When a session begins:
  1. Your repo is cloned
  2. A unique branch is created
  3. Your startup commands run
  4. Env vars are injected

- After every message, the agent:
  - Looks for file changes
  - Commits them
  - Pushes to the session’s branch

- Containers are **ephemeral**:
  - Spindown occurs after inactivity
  - Expect slightly longer setup after idle periods
  - Inactive cloud agent sessions are deleted after **7 days** during the beta, expired sessions are still accessible via the CLI

## Agent Environment Profiles

Agent environment profiles are reusable bundles of environment settings for cloud-agent sessions. A profile can include:

- Environment variables (plaintext)
- Secrets (encrypted at rest; decrypted only by the cloud agent)
- Setup commands (which Cloud Agent will execute before starting a session)

Profiles are owned by either a user or an organization. Names are unique per owner, and each owner can have a single default profile. This lets teams share standard environment setups across multiple sessions and triggers.

## Environment Variables & Secrets & Startup Commands

You can customize each Cloud Agent session by also defining env vars and startup commands on the fly. These will override any Agent Environment Profile you've selected:

### Environment Variables

- Add key/value pairs or secrets
- Injected into the container before the session starts
- Useful for API keys or config flags

### Startup Commands

- Commands run immediately after cloning the repo and checking out the session branch
- Great for:
  - Installing dependencies
  - Bootstrapping tooling
  - Running setup scripts

### Setup Commands vs `.kilocode/setup-script`

- Cloud Agent executes **Setup Commands** configured in the Cloud UI/profile.
- Cloud Agent does **not** automatically discover or run `.kilocode/setup-script`.
- If you want to use `.kilocode/setup-script` in Cloud Agent, call it explicitly from Setup Commands, for example: `bash .kilocode/setup-script`.
- If both are present, execution order is:
  1. Setup Commands (in the order you define them)
  2. Anything those commands invoke (such as `.kilocode/setup-script`)

## Skills

Cloud Agents support project-level [skills](/docs/code-with-ai/platforms/cli#skills) stored in your repository. When your repo is cloned, any skills in `.kilocode/skills/` are automatically available.

{% callout type="note" %}
Global skills (`~/.kilocode/skills/`) are not available in Cloud Agents since there is no persistent user home directory.
{% /callout %}

## Remote Connections

Remote Connections let you access and control local CLI sessions from the Cloud Agents web interface. Your computer handles the compute; the cloud gives you a window into it from any device.

### How It Works

When remote mode is enabled in the CLI, your active local sessions appear in the Cloud Agents dashboard alongside cloud sessions. The connection is two-way:

- **Messages and responses** sync in real-time
- **Agent questions** appear in both places — answer wherever you are
- **Permission requests** route to your active connection
- **Full editing capabilities** work remotely

### Enabling Remote Mode

Remote mode must be enabled from the CLI. See [CLI Remote Connections](/docs/code-with-ai/platforms/cli#remote-connections) for setup instructions.

### Requirements

- Same Kilo account on both CLI and Cloud Agent
- Active internet connection on the local machine
- CLI must remain running

{% callout type="warning" title="Security Warning" %}
Anyone with access to your Kilo account can send messages to your computer when remote mode is enabled.
{% /callout %}

## Perfect For

Cloud Agents are great for:

- **Remote debugging** using Kilo Code debug mode
- **Exploration of unfamiliar codebases** without touching your local machine
- **Architect-mode brainstorming** while on the go
- **Automated refactors or tech debt cleanup** driven by Kilo Code
- **Offloading CI-like tasks**, experiments, or batch updates

## Triggers

Triggers allow you to initiate cloud agent sessions automatically, either via HTTP requests (webhooks) or on a recurring schedule. This enables integration with external services and time-based automation workflows.

{% callout type="note" %}
Triggers are currently in beta and subject to change.
{% /callout %}

### Accessing Triggers

Triggers are accessible from the main sidebar under **Webhooks / Triggers** and link to [https://app.kilo.ai/cloud/triggers](https://app.kilo.ai/cloud/triggers) for personal accounts. Organization-level trigger configurations are available through your organization's sidebar.

### Activation Modes

When creating a trigger, you choose an **activation mode** that cannot be changed after creation:

- **Webhook**: Fires when an external service sends an HTTP request to the trigger's URL
- **Scheduled**: Fires on a recurring schedule defined by a cron expression

### Configuration

Triggers utilize [agent environment profiles](#agent-environment-profiles) to configure the execution environment for triggered sessions. The agent resolves the profile at runtime, so profile updates apply automatically to future executions. Profiles referenced by triggers cannot be deleted until those triggers are updated or removed.

Triggers do not support manual env var or setup command overrides at this time.

### Scheduled Triggers

Scheduled triggers fire on a recurring schedule using cron expressions. You can configure them with a simple frequency picker (every 10 minutes, hourly, daily, weekly) or enter a raw cron expression for full control. Each trigger has a configurable timezone (default: UTC) and handles daylight saving time transitions automatically.

The minimum schedule interval is 10 minutes. Scheduled triggers use `{{scheduledTime}}` and `{{timestamp}}` as prompt template variables (webhook-specific variables like `{{body}}` are not available since there is no inbound HTTP request).

### Trigger Limits and Guidance

Triggers are designed for low-volume invocations from trusted sources and are best suited for short-lived tasks.

- **Personal triggers**: Execute in the same sandbox container as a user's Cloud Agent sessions. You can view/join invocations live.
- **Organization triggers**: Execute in dedicated compute resources as a bot user, similar to Code Review sessions. You can share/fork the sessions when they're complete.

Additional limits:

- **Payload size**: max **256 KB** per request body (larger payloads return `413`)
- **Content types**: binary and multipart payloads are rejected (`415`) such as `multipart/*`, `application/octet-stream`, `image/*`, `audio/*`, `video/*`, `application/pdf`, `application/zip`
- **Retention**: only the **most recent 100 requests per trigger** are retained
- **In-flight cap**: at most **20 requests per trigger** can be in `captured` or `inprogress` at once (returns `429`)

The trigger endpoint will return rate limit responses when the number of queued or processing requests exceeds system capacity.

### Prompt Template Variables

You can reference data in a trigger’s prompt template using these placeholders.

**Webhook triggers:**

- `{{body}}` - raw request body (string)
- `{{bodyJson}}` - pretty-printed JSON if parseable, otherwise raw body
- `{{method}}` - HTTP method (GET, POST, etc.)
- `{{path}}` - request path
- `{{headers}}` - JSON-formatted request headers
- `{{query}}` - query string without leading `?` (empty if none)
- `{{sourceIp}}` - client IP if provided (falls back to `unknown`)
- `{{timestamp}}` - capture timestamp (ISO string)

**Scheduled triggers:**

- `{{scheduledTime}}` - the time the schedule fired (ISO string)
- `{{timestamp}}` - capture timestamp (ISO string)

{% callout type="warning" title="Security Considerations" %}
Care should be taken when deciding to use webhooks as they are susceptible to prompt injection attacks. Especially in scenarios where webhook payloads may contain untrusted input. At this time we recommend using webhooks only for trusted sources.
{% /callout %}

## General Cloud Agent Limitations and Guidance

- Each message can run for **up to 15 minutes**.
  Break large tasks into smaller steps; use a `plan.md` or `todo.md` file to keep scope clear.
- **Context is persistent across messages.**
  Kilo Code remembers previous turns within the same session.
- **Auto/YOLO mode is always on.**
  The agent will modify code without prompting for confirmation.
- **Sessions are restorable locally** and local sessions can be resumed in Cloud Agent.
- **Sessions prior to December 9th 2025** may not be accessible in the web UI.
- **MCP support is coming**, but **Docker-based MCP servers will _not_ be supported**.
