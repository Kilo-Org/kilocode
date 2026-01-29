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

## Skills

Cloud Agents support project-level [skills](/docs/code-with-ai/platforms/cli#skills) stored in your repository. When your repo is cloned, any skills in `.kilocode/skills/` are automatically available.

{% callout type="note" %}
Global skills (`~/.kilocode/skills/`) are not available in Cloud Agents since there is no persistent user home directory.
{% /callout %}

## Perfect For

Cloud Agents are great for:

- **Remote debugging** using Kilo Code debug mode
- **Exploration of unfamiliar codebases** without touching your local machine
- **Architect-mode brainstorming** while on the go
- **Automated refactors or tech debt cleanup** driven by Kilo Code
- **Offloading CI-like tasks**, experiments, or batch updates

## Webhook Triggers

Webhook triggers allow you to initiate cloud agent sessions via HTTP requests. This enables integration with external services and automation workflows.

{% callout type="note" %}
Webhook triggers are currently in beta and subject to change.
{% /callout %}

### Accessing Webhooks

Webhook triggers are accessible from the main sidebar with an entry named **Webhook** and link to [https://app.kilo.ai/cloud/webhooks](https://app.kilo.ai/cloud/webhooks) for personal accounts. Organization-level webhook configurations are available through your organization's sidebar.

### Configuration

Webhook triggers utilize [agent environment profiles](#agent-environment-profiles) to configure the execution environment for triggered sessions. The agent resolves the profile at runtime, so profile updates apply automatically to future executions. Profiles referenced by triggers cannot be deleted until those triggers are updated or removed.

Webhook triggers do not support manual env var or setup command overrides at this time.

### Trigger Limits and Guidance

Webhook triggers are designed for low-volume invocations from trusted sources and are best suited for short-lived tasks.

- **Personal webhooks**: Execute in the same sandbox container as a user's Cloud Agent sessions. You can view/join invocations live.
- **Organization webhooks**: Execute in dedicated compute resources as a bot user, similar to Code Review sessions. You can share/fork the sessions when they're complete.

Additional limits:

- **Payload size**: max **256 KB** per request body (larger payloads return `413`)
- **Content types**: binary and multipart payloads are rejected (`415`) such as `multipart/*`, `application/octet-stream`, `image/*`, `audio/*`, `video/*`, `application/pdf`, `application/zip`
- **Retention**: only the **most recent 100 requests per trigger** are retained
- **In-flight cap**: at most **20 requests per trigger** can be in `captured` or `inprogress` at once (returns `429`)

The webhook endpoint will return rate limit responses when the number of queued or processing requests exceeds system capacity.

### Webhook Prompt Template Variables

You can reference request data in a trigger’s prompt template using these placeholders:

- `{{body}}` - raw request body (string)
- `{{bodyJson}}` - pretty-printed JSON if parseable, otherwise raw body
- `{{method}}` - HTTP method (GET, POST, etc.)
- `{{path}}` - request path
- `{{headers}}` - JSON-formatted request headers
- `{{query}}` - query string without leading `?` (empty if none)
- `{{sourceIp}}` - client IP if provided (falls back to `unknown`)
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
