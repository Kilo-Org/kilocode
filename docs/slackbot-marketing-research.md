# Kilo Slackbot / Kilo Bot — Marketing Research

> Comprehensive research gathered from documentation, source code, architecture docs, landing pages, and the kilo.ai website. Intended for marketing use.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Slackbot Capabilities](#2-slackbot-capabilities)
3. [The "Start on Mobile, Pick Up on Desktop" Workflow](#3-the-start-on-mobile-pick-up-on-desktop-workflow)
4. [Cross-Platform Support (GitHub & GitLab)](#4-cross-platform-support-github--gitlab)
5. [Kilo Bot (GitHub/GitLab Bot)](#5-kilo-bot-githubgitlab-bot)
6. [Cloud Agent — The Engine Behind the Slackbot](#6-cloud-agent--the-engine-behind-the-slackbot)
7. [Related Automation Features](#7-related-automation-features)
8. [Recent Improvements & Current Status](#8-recent-improvements--current-status)
9. [Existing Marketing Copy & Documentation](#9-existing-marketing-copy--documentation)
10. [Key Marketing Angles](#10-key-marketing-angles)
11. [Source File Reference](#11-source-file-reference)

---

## 1. Product Overview

**Kilo for Slack** is a Slack integration that brings Kilo Code's AI coding capabilities directly into a team's Slack workspace. Users can ask questions about their repositories, request code implementations, debug issues, and create pull/merge requests — all without leaving Slack.

The Slackbot is powered by the **Cloud Agent** infrastructure, which runs the Kilo CLI in isolated Linux containers on Cloudflare Workers. The Slackbot dispatches work to Cloud Agents, which clone repos, create branches, make changes, and push code.

**Kilo Bot** is a related but distinct product — it's the GitHub/GitLab bot that responds to issue comments and PR mentions (triggered via `/kilo` or `/kc`), also dispatching work to the Cloud Agent.

### Architecture Position

From the official architecture diagram:

```
Slack → Cloud Agent → Kilo CLI (in sandbox) → GitHub/GitLab
Kilo Bot → Cloud Agent → Kilo CLI (in sandbox) → GitHub/GitLab
```

Both the Slackbot and Kilo Bot are thin interfaces that dispatch tasks to the Cloud Agent, which runs the full Kilo CLI engine in an isolated container.

---

## 2. Slackbot Capabilities

### Core Features

| Capability                       | Description                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Ask questions about repos**    | Get explanations about code, architecture, or implementation details from connected repositories |
| **Request code implementations** | Tell the bot to implement fixes or features discussed in Slack threads                           |
| **Debugging assistance**         | Share error messages or stack traces and get AI-powered analysis                                 |
| **Team collaboration**           | Mention `@Kilo` in any channel for contextual help during team discussions                       |
| **Create PRs/MRs**               | For implementation requests, Kilo creates branches, commits code, and opens pull/merge requests  |
| **Thread context awareness**     | The bot reads Slack thread context to understand proposed solutions                              |
| **400+ model support**           | Users can choose from 400+ AI models via Integrations > Slack at app.kilo.ai                     |
| **Direct Messages**              | Private conversations for sensitive debugging or personal productivity                           |
| **Channel Mentions**             | `@Kilo` in any channel for team-visible AI assistance                                            |

### How It Works (User Flow)

1. **Message Kilo** — Either through DMs or by mentioning `@Kilo` in a channel
2. **Kilo processes the request** — Uses connected repositories to understand context
3. **AI generates a response** — Analyzes the request and provides a helpful response
4. **Code changes (if requested)** — Creates a branch, implements changes, pushes to the repo, and opens a PR/MR

### Implementation Request Flow (Detailed)

When a user asks the bot to implement something from a Slack discussion, the bot:

- Reads the context from the Slack thread
- Understands the proposed solution
- Creates a branch with the implementation
- Pushes the changes to the repository
- Opens a pull request or merge request

### Interaction Modes

| Mode                 | Best For                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| **Direct Messages**  | Private code questions, sensitive debugging, personal productivity           |
| **Channel Mentions** | Team discussions, collaborative debugging, quick answers during code reviews |

---

## 3. The "Start on Mobile, Pick Up on Desktop" Workflow

This is a key marketing story supported by multiple platform features working together. Here's how it works:

### The Promise

From the Getting Started docs:

> _"Your sessions sync across all of these, so you can start a task on your phone and finish it in your IDE."_

### The Workflow

1. **Start on Slack (mobile)**: A developer is commuting or away from their desk. They open Slack on their phone and message `@Kilo`:

   > "Can you implement the fix for the null pointer exception in the order processing service?"

2. **Cloud Agent executes**: Kilo's Cloud Agent spins up an isolated Linux container, clones the repo, creates a branch, implements the fix, commits, and pushes — all in the cloud.

3. **Pick up in IDE or CLI**: When the developer gets to their desk, they can:
   - **In VS Code**: Open the Cloud Session List (accessible via the extension), browse cloud sessions, and import the session locally. The extension supports read-only cloud session retrieval, session preview, and import.
   - **In CLI**: Use `kilo import` to pull the cloud session into a local session, or resume it in the Cloud Agent web UI at app.kilo.ai.

4. **Session continuity**: Sessions are restorable locally, and local sessions can be resumed in the Cloud Agent. The context is persistent across messages.

### Technical Implementation

- **Cloud sessions sync via SDK**: The `@kilocode/sdk` exposes endpoints for cloud session management (`/kilo/cloud/session/{id}`, `/kilo/cloud/session/import`, `/kilo/cloud-sessions`)
- **VS Code extension**: Has `CloudSessionList` component, `selectCloudSession()`, `handleCloudSessionImported()` functions, and full import workflow
- **CLI integration**: The `importCloudSession()` and `validateCloudFork()` functions are used in the TUI, headless run mode, and attach command
- **Auto-branching and auto-commit**: Every message to the Cloud Agent triggers a commit and push, so work is never lost

### Current Status (from VS Code Cloud Task Support spec)

| Feature                             | Status              |
| ----------------------------------- | ------------------- |
| Read-only cloud session retrieval   | Implemented         |
| CloudSessionList component          | Implemented         |
| Cloud session preview/import        | Implemented         |
| Upload/sync local sessions to cloud | Not yet implemented |
| Real-time sync between devices      | Not yet implemented |
| Conflict resolution                 | Not yet implemented |

---

## 4. Cross-Platform Support (GitHub & GitLab)

### Supported Platforms

| Platform      | Integration Type               | How It Connects                                                             |
| ------------- | ------------------------------ | --------------------------------------------------------------------------- |
| **GitHub**    | GitHub App (KiloConnect)       | Install via app.kilo.ai Integrations page. Select repos for access.         |
| **GitLab**    | OAuth or Personal Access Token | Supports GitLab.com and self-hosted instances. OAuth auto-refreshes tokens. |
| **Bitbucket** | Planned                        | Not yet available                                                           |

### What the Integration Enables

Once a Git provider is connected, the following features are unlocked:

- **Kilo for Slack** — Full Slackbot functionality with repo access
- **Cloud Agents** — Remote AI coding in isolated containers
- **Code Reviews** — Automated AI review on every PR/MR
- **Kilo Deploy** — Deploy Next.js apps directly from Kilo
- **Kilo Bot** — GitHub/GitLab bot responding to issue/PR comments
- **Auto Triage** — Automated issue classification and duplicate detection
- **Security Reviews** — Dependabot alert triage and CVE analysis

### GitHub-Specific Features

- **KiloConnect GitHub App**: The official app for connecting GitHub repos
- **Bot identities**: `kilo-maintainer[bot]`, `kiloconnect[bot]`, `kiloconnect-lite[bot]`
- **GitHub Action**: A composite action (`Kilo-Org/kilocode/github@latest`) for triggering Kilo tasks from issue/PR comments via `/kilo` or `/kc`

### GitLab-Specific Features

- **OAuth or PAT**: Two connection methods
- **Self-hosted support**: Works with both GitLab.com and self-hosted instances
- **"Kilo Code Review Bot" identity**: Created via Project Access Token for code reviews
- **Automatic webhook management**: Webhooks are set up and managed automatically

---

## 5. Kilo Bot (GitHub/GitLab Bot)

The **Kilo Bot** is distinct from the Slackbot — it's the GitHub/GitLab bot that responds to issue comments and PR mentions.

### Capabilities

| Command                                | Effect                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| `/kilo explain this issue`             | Reads the entire issue thread and replies with a clear explanation |
| `/kilo fix this`                       | Creates a new branch, implements changes, and opens a PR           |
| `/kc [change request]` on a PR         | Implements the requested change and commits to the same PR         |
| `/kc [request]` on specific code lines | Detects file, line numbers, and diff context for precise responses |

### How It Works

- Triggered by `/kilo` or `/kc` mentions in GitHub issue or PR comments
- Dispatches work to the Cloud Agent
- Can explain issues, fix issues, review PRs, and make targeted code changes
- Receives file path, line numbers, and diff context when commenting on specific code lines

### Architecture Definition

> _"The GitHub/GitLab bot that responds to issue comments and PR mentions. It dispatches work to the Cloud Agent, enabling users to trigger AI coding tasks directly from their repositories."_

---

## 6. Cloud Agent — The Engine Behind the Slackbot

The Cloud Agent is the infrastructure that powers both the Slackbot and Kilo Bot.

### Key Specs

| Spec                    | Details                                                     |
| ----------------------- | ----------------------------------------------------------- |
| **Runtime**             | Cloudflare Workers + isolated Linux containers              |
| **Container**           | One per user; each session gets its own workspace directory |
| **Pre-installed tools** | Node.js, git, gh CLI, glab CLI, etc.                        |
| **Max message time**    | 15 minutes per message                                      |
| **Auto-commit**         | After every message, changes are committed and pushed       |
| **Mode**                | Auto/YOLO mode always on (no confirmation prompts)          |
| **Session retention**   | 7 days during beta (expired sessions accessible via CLI)    |
| **Compute cost**        | Free during limited beta                                    |
| **Credits**             | Kilo Code credits used for model inference                  |

### Features

- **Agent Environment Profiles**: Reusable bundles of env vars, secrets, and setup commands
- **Webhook Triggers (beta)**: Initiate sessions via HTTP requests for automation
- **Skills support**: Project-level skills from `.kilocode/skills/` are auto-discovered
- **Session portability**: Sessions restorable locally; local sessions resumable in Cloud Agent

---

## 7. Related Automation Features

### Automated Code Reviews

- AI review on every PR/MR (GitHub and GitLab)
- Three review styles: Strict, Balanced, Lenient
- Six focus areas: Security, Performance, Bugs, Style, Testing, Documentation
- Configurable max review time (5-30 minutes)
- Inline comments + summary findings posted directly on the PR/MR
- Available locally via VS Code Review mode or CLI `/local-review` command

### Auto Triage

- Automatic GitHub issue classification (bug, feature, question, unclear)
- Duplicate detection via vector similarity search
- Automatic labeling (`kilo-triaged`, `kilo-duplicate`)
- Confidence scoring with AI reasoning

### Security Reviews

- Syncs Dependabot alerts
- AI-powered CVE triage
- Reachability analysis for vulnerabilities
- Auto-dismissal of non-exploitable findings

---

## 8. Recent Improvements & Current Status

### Current State

- **Kilo for Slack**: Generally available at https://app.kilo.ai/get-started/slack
- **Cloud Agent**: In limited beta (compute free during beta)
- **Code Reviews**: In limited beta
- **Webhook Triggers**: In beta
- **Mobile Apps (iOS/Android)**: Coming soon
- **Bitbucket Integration**: Planned

### Architecture Highlights

- The Slackbot, Kilo Bot, Code Review, Auto Triage, and App Builder all dispatch work to the Cloud Agent
- Cloud Agent runs the full Kilo CLI in sandboxed containers
- Session data syncs between Cloud Agent, VS Code extension, and CLI
- 400+ model support for the Slackbot (configurable per workspace)

### VS Code Extension Cloud Session Support

The VS Code extension has partial cloud session support implemented:

- Cloud session listing with repo filtering and date grouping
- Cloud session preview and import
- Import via session ID, URL, or `kilo import` command
- Upload/sync from local to cloud is not yet implemented

### Doc URL Migration

The Slack docs have been migrated from their original locations:

- `/docs/advanced-usage/slackbot` → `/docs/code-with-ai/platforms/slack`
- `/docs/slack` → `/docs/code-with-ai/platforms/slack`

---

## 9. Existing Marketing Copy & Documentation

### Landing Page (kilo.ai/features/slack)

**Headline**: "Kilo for Slack"
**Subheadline**: "Address Kilo directly in Slack to ask questions about your codebase, get code explanations, or create pull requests via cloud agents—all without leaving your team chat."

**Key Benefits** (as listed on the page):

1. Ask questions about your codebase directly in Slack
2. Get instant code explanations and documentation
3. Create pull requests via cloud agents from Slack
4. Collaborate on debugging with your team
5. No context switching between tools
6. Works with your existing Slack channels and workflows

**Use Cases** (as listed on the page):

1. Quick codebase questions during team discussions
2. Onboarding new team members with instant code explanations
3. Triggering automated PR creation for routine tasks
4. Collaborative debugging sessions in Slack threads
5. Code review discussions with AI assistance

**About Section**:

> "Bring the power of Kilo Code directly into your Slack workspace. Mention @Kilo in any channel or DM to ask questions about your codebase, get instant code explanations, debug issues collaboratively, or even kick off cloud agents to create pull requests. Perfect for teams who want AI-assisted development integrated into their existing communication workflow."

### Documentation Page (kilo.ai/docs/code-with-ai/platforms/slack)

Full 175-line documentation page covering:

- What You Can Do
- Supported Platforms (GitHub, GitLab)
- Prerequisites
- How to Interact (DMs and Channel Mentions)
- Use Cases (Ask questions, Implement fixes, Debug issues)
- How It Works (4-step flow)
- Cost (credits-based)
- Tips for Best Results
- Limitations
- Changing the Model (400+ models)
- Troubleshooting

### Install Partial

Reusable install snippet with "Add to Slack" button linking to `https://app.kilo.ai/get-started/slack`.

### Getting Started Page

> "**Slack** — Chat with Kilo directly in your workspace"
> "Your sessions sync across all of these, so you can start a task on your phone and finish it in your IDE."

### Navigation & Information Architecture

- Slack appears under "Code with AI > Platforms" alongside VS Code, JetBrains, CLI, Cloud Agent, and Mobile Apps
- Slack is listed in the Getting Started intro page as a top-level platform
- Slack has its own feature page on kilo.ai website at `/features/slack`

---

## 10. Key Marketing Angles

Based on all research, here are the strongest marketing angles:

### 1. "Code from Anywhere" / Mobile-First Development

- Start tasks on your phone via Slack, pick them up in your IDE
- Sessions sync across Slack, Cloud Agent, VS Code, and CLI
- No laptop required to kick off meaningful development work

### 2. Zero Context Switching

- Ask codebase questions without leaving Slack
- Get AI-powered debugging help in the same tool your team already uses
- Create PRs directly from team conversations

### 3. Thread-to-PR Pipeline

- Team discusses a bug or feature in a Slack thread
- Mention `@Kilo` to implement the discussed solution
- Bot reads thread context, creates a branch, implements the fix, opens a PR
- Transforms Slack discussions into shipped code

### 4. Team Collaboration at Scale

- Every team member can trigger AI coding tasks from Slack
- Private DMs for sensitive work, channel mentions for team visibility
- 400+ model selection per workspace
- Works with both GitHub and GitLab (including self-hosted GitLab)

### 5. Full Platform Ecosystem

- Slack is one surface in a unified platform: VS Code, JetBrains, CLI, Cloud Agent, GitHub Action, Mobile (coming soon)
- Same AI engine, same sessions, same credits across all surfaces
- Enterprise-grade with org-level settings and integrations

### 6. Automation Pipeline

- Slackbot is one entry point into a broader automation ecosystem
- Connects to: Code Reviews, Auto Triage, Security Reviews, Webhook Triggers, App Builder
- All powered by the same Cloud Agent infrastructure

---

## 11. Source File Reference

| File                                                                 | Content                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/kilo-docs/pages/code-with-ai/platforms/slack.md`           | Primary Slack documentation (175 lines)                         |
| `packages/kilo-docs/pages/code-with-ai/platforms/cloud-agent.md`     | Cloud Agent documentation (176 lines)                           |
| `packages/kilo-docs/pages/contributing/architecture/index.md`        | Architecture overview with Kilo Bot and Cloud Agent definitions |
| `packages/kilo-docs/pages/getting-started/index.md`                  | Getting started page with session sync mention                  |
| `packages/kilo-docs/pages/code-with-ai/platforms/mobile.md`          | Mobile apps (coming soon)                                       |
| `packages/kilo-docs/pages/automate/code-reviews/overview.md`         | Code Reviews documentation                                      |
| `packages/kilo-docs/pages/automate/integrations.md`                  | GitHub/GitLab integration setup                                 |
| `packages/kilo-docs/pages/automate/auto-triage/overview.md`          | Auto Triage documentation                                       |
| `packages/kilo-docs/markdoc/partials/install-slack.md`               | Slack install partial                                           |
| `packages/kilo-docs/pages/kiloclaw/chat-platforms.md`                | KiloClaw Slack integration (separate product)                   |
| `packages/kilo-docs/previous-docs-redirects.js`                      | URL redirects from old Slack doc paths                          |
| `packages/kilo-vscode/docs/non-agent-features/cloud-task-support.md` | VS Code cloud session support spec                              |
| `github/README.md`                                                   | Kilo GitHub Action documentation                                |
| `.github/workflows/check-org-member.yml`                             | CI workflow with Kilo bot identities                            |
| `kilo.ai/features/slack` (website)                                   | Landing page with marketing copy                                |
| `kilo.ai/docs/code-with-ai/platforms/slack` (website)                | Published documentation page                                    |
