---
title: "Cloud Agent"
description: "Using Kilo Code in the browser"
---

# {% $markdoc.frontmatter.title %}

Cloud Agents let you run Kilo Code in the cloud from any device, without relying on your local machine. They provide a remote development environment that can read and modify your GitHub, GitLab, or Bitbucket repositories, run commands, and optionally commit and push changes as work progresses. Bitbucket repositories are available for organizations only.

## What Cloud Agents Enable

- Run Kilo Code remotely from a browser
- Create branches and optionally commit and push changes automatically
- Use env vars + startup commands to shape the workspace
- Work from anywhere while keeping your repo in sync

## Prerequisites

Before using Cloud Agents:

- **A GitHub, GitLab, or Bitbucket integration must be configured**
  Connect your account via the [Integrations tab](https://app.kilo.ai/integrations) so that Cloud Agents can access your repositories. For Bitbucket, use your organization's **Integrations** page; its repositories are available in both web and mobile Cloud Agent sessions.

## Cost

Cloud Agent compute is billed per second while the container is awake. Compute and model inference draw from the same Kilo credit balance, but they are charged separately.

| Cloud Agent size | Hourly rate |
|---|---|
| Docker | $0.60 |
| Small | $0.60 |
| Standard | $1.20 |

Usage is measured in whole seconds, with no rounding up to a longer billing interval and no minimum usage charge. Your balance must contain at least $5 to launch a container, but this is not an extra charge or minimum spend. BYOK users still pay for cloud compute because their provider keys cover inference only.

See [Kilo Code pricing](https://kilo.ai/pricing) for current rates and pricing for other cloud products.

### Session cost display

The session header separates **Token Usage** (model inference spend) from **Compute** (the cloud environment's estimated hourly rate). Several sessions can share that environment, so the rate is not a per-session spending total. **Not currently charged** means compute charges are not being applied.

If a compute billing check fails, follow the recovery action next to the composer. Available actions depend on whether you or your organization pays and your role in that organization. Your prompt is preserved so you can retry after resolving the issue.

## How to Use

1. **Connect your GitHub, GitLab, or Bitbucket account** in the [Integrations](https://app.kilo.ai/integrations) tab of your personal or organization dashboard. Bitbucket requires an organization.
2. **Select a repository** to use as your workspace.
3. **Add environment variables** (secrets supported) and set optional startup commands.
4. **Start chatting with Kilo Code.**

Automatic commit and push depends on your session settings. If it is disabled, review, commit, and push the changes you want to keep.

## Starting Tasks from the CLI

Use the `kilo cloud` command to run Cloud Agent tasks without opening the browser:

```bash
kilo cloud start --prompt "Fix the flaky login test" --repo Kilo-Org/kilocode
```

`kilo cloud` can start tasks, send follow-up prompts, and check task status and results. Repository, branch, model, mode, and organization are inferred from your local checkout and CLI defaults unless you pass the matching flags. Add `--stream` to `kilo cloud start` to print task events as JSONL until the task completes. See the [CLI reference](/docs/code-with-ai/platforms/cli-reference#kilo-cloud) for all commands and options.

`kilo cloud start` and `kilo cloud send` require exactly one prompt source: `--prompt` or `--prompt-stdin`. Use `--prompt-stdin` to read a file or another command's output from standard input:

```bash
kilo cloud start --prompt-stdin --repo Kilo-Org/kilocode < task.md
```

Standard-input prompts must be valid UTF-8 and contain no more than 100,000 characters.

## How Cloud Agents Work

- Each user receives an **isolated Linux container** with common dev tools preinstalled (Node.js, git, gh CLI, glab CLI, etc.).
- Python is not included in the base image, but `apt` is available so you can install it or other packages as needed.
- All Cloud Agent chats share a **single container instance**. Each worktree has its own checkout directory, and chats in the same worktree share it.
- When a new worktree is created:
  1. Your repo is cloned
  2. A unique branch is created
  3. Your startup commands run
  4. Env vars are injected

- When automatic commit and push is enabled, after each message the agent:
  - Looks for file changes
  - Commits them
  - Pushes to the session’s branch

Each commit the agent creates also appears in the chat transcript as a compact entry. Hover or tap the entry to see its metadata, including the commit message and push status.

- Containers are **ephemeral**:
  - Spindown occurs after inactivity
  - Expect slightly longer setup after idle periods
  - Inactive cloud agent sessions are deleted after **7 days** during the beta, expired sessions are still accessible via the CLI

## Worktrees and chats

A worktree is a checkout of your repository on its own branch. It can host multiple chats with separate conversations, but edits from one chat are visible to the others. Use separate worktrees for tasks that need separate checkouts.

Each chat opens as its own tab in the worktree group. You can rename tabs, close and reopen them, or delete a whole worktree and all of its chats.

### Workspace folders

Group worktrees into folders in the sidebar. Folders are private to you, not shared with your organization.

- Create a folder with a name and an optional color, then drag worktrees onto it.
- Use the folder menu to rename it, change its color, move it up or down, or delete it. Deleting a folder returns its worktrees to **Ungrouped** without deleting them.
- Click a folder's header to collapse or expand it.

## Reviewing changes

Select **Changes** in the chat header to review the worktree's saved change summary, including file status and lines added and removed. The panel shows the comparison's base branch and when the summary was saved. Refresh the panel to load the latest saved summary. Large summaries can be partial, with some files or line counts omitted.

Select a file to open its saved diff and, when available, full contents in a read-only tab. Reloading reads the latest saved revision without starting the workspace.

These are saved snapshots, not a live view of the checkout. Diffs or contents may be unavailable for binary, unsupported, or large files, or when there are too many changes to save in full.

### Sending a review to the agent

While a saved diff is open, select a line or a range and add a comment. Drafts are kept per file, so you can comment across several files and send them together.

Sending a review delivers all of its comments to the agent as a single message in the chat that owns the worktree. If the saved diff changes before you send, Kilo treats the review as stale and asks you to confirm, so comments stay pinned to the revision you reviewed.

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

### Setup Commands vs `.kilo/setup-script`

- Cloud Agent executes **Setup Commands** configured in the Cloud UI/profile.
- Cloud Agent does **not** automatically discover or run `.kilo/setup-script`.
- If you want to use `.kilo/setup-script` in Cloud Agent, call it explicitly from Setup Commands, for example: `bash .kilo/setup-script`.
- If both are present, execution order is:
  1. Setup Commands (in the order you define them)
  2. Anything those commands invoke (such as `.kilo/setup-script`)

## Skills

Cloud Agents support project-level [skills](/docs/code-with-ai/platforms/cli#skills) stored in your repository. When your repo is cloned, any skills in `.kilo/skills/` (or the legacy `.kilocode/skills/`) are automatically available. Skill folders are uploaded as `.zip` archives, with up to 40 companion files per skill.

{% callout type="note" %}
Global skills (`~/.kilo/skills/`) are not available in Cloud Agents since there is no persistent user home directory.
{% /callout %}

## Remote Connections

Remote Connections let you access and control local CLI sessions from the Cloud Agents web interface. Your computer handles the compute; the cloud gives you a window into it from any device.

### How It Works

When remote mode is enabled in the CLI, your active local sessions appear in the Cloud Agents dashboard alongside cloud sessions. The connection is two-way:

- **Messages and responses** sync in real-time
- **Agent questions** appear in both places — answer wherever you are
- **Permission requests** route to your active connection
- **Full editing capabilities** work remotely
- **Session renames** sync in both directions between the CLI and the web or mobile app
- **File attachments** sync with the mobile app — send files from your phone to the CLI, and receive files the agent delivers back. See [Attachments in remote sessions](/docs/code-with-ai/platforms/mobile#attachments-in-remote-sessions)

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

Use Cloud Agent triggers when an HTTP event or schedule should start a Cloud Agent
session against a repository.

### Accessing Triggers

Triggers are accessible from the main sidebar under **Webhooks / Triggers** and link to [https://app.kilo.ai/cloud/triggers](https://app.kilo.ai/cloud/triggers) for personal accounts. Organization-level trigger configurations are available through your organization's sidebar.

### Activation Modes

When creating a trigger, you choose an **activation mode** that cannot be changed after creation:

- **Webhook**: Fires when an external service sends an HTTP request to the trigger's URL
- **Scheduled**: Fires on a recurring schedule defined by a cron expression

### Configuration

Triggers utilize [agent environment profiles](#agent-environment-profiles) to configure the execution environment for triggered sessions. The agent resolves the profile at runtime, so profile updates apply automatically to future executions. Profiles referenced by triggers cannot be deleted until those triggers are updated or removed.

For models that support it, webhook and scheduled triggers can set a **reasoning effort** next to the model selector. **Default** leaves the model's behavior unchanged; a specific effort applies to each session the trigger starts.

Triggers do not support manual env var or setup command overrides at this time.

### Scheduled Triggers

Scheduled triggers fire on a recurring schedule using cron expressions. You can configure them with a simple frequency picker (every 10 minutes, hourly, daily, weekly) or enter a raw cron expression for full control. Each trigger has a configurable timezone (default: UTC) and handles daylight saving time transitions automatically.

The minimum schedule interval is 10 minutes. Scheduled triggers use `{{scheduledTime}}` and `{{timestamp}}` as prompt template variables (webhook-specific variables like `{{body}}` are not available since there is no inbound HTTP request).

### Invoking a scheduled trigger on demand

To run an active scheduled trigger immediately, select the **Play** action on its row and confirm. When editing one, use **Save and invoke now** to save your changes before starting the run. Paused triggers cannot be invoked, and webhook triggers have no invoke action.

Manual invocations use the same queue and in-flight limits as scheduled runs. Invoking alone does not change the cron schedule, timezone, or next scheduled occurrence; any schedule edits saved with **Save and invoke now** still take effect.

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

### Request History

Open a trigger's request history to inspect recent invocations. History entries
show the source (webhook or scheduled), status such as captured, in progress,
success, or failed, request metadata, payload details when available, and links
or sharing actions for the resulting session. Use this view to debug webhook
payloads, scheduled runs, and organization handoff without changing the trigger
configuration.

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
