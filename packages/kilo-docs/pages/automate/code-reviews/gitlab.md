---
title: "GitLab Code Reviews"
description: "Set up automated AI code reviews on GitLab merge requests"
---

# GitLab Code Reviews

Kilo's Code Reviews integrate with GitLab to automatically review merge requests with AI. When an MR is opened, updated, or reopened, the Review Agent analyzes the changes and posts feedback directly on the merge request — as summary notes and inline discussion comments.

Both **GitLab.com** and **self-hosted GitLab instances** are supported.

## Prerequisites

- A Kilo Code account at [app.kilo.ai](https://app.kilo.ai)
- A GitLab account with **Maintainer** role (or higher) on the projects you want to review
- Kilo Code credits for AI model usage

> **Why Maintainer role?** Kilo creates a bot account (Project Access Token) on each project so that review comments appear from a bot, not your personal account. This requires Maintainer access.

## Setup

### Step 1: Connect GitLab

Connect your GitLab account via the [Integrations page](/docs/automate/integrations#connecting-gitlab). You can use **OAuth** (GitLab.com or self-hosted) or a **Personal Access Token (PAT)**.

Once connected, return here to configure the Review Agent.

### Step 2: Configure the Review Agent

1. Go to **Code Reviews**:
   - **Personal**: [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews)
   - **Organization**: Your organization → Code Reviews
2. Toggle **Enable AI Code Review** to on
3. Configure your preferences:
   - **AI Model** — Select from available models (default: Claude Sonnet 4.5)
   - **Review Style** — Strict, Balanced, or Lenient
   - **Repository Selection** — All repositories or select specific ones
   - **Focus Areas** — Security, performance, bugs, style, testing, documentation
   - **Max Review Time** — 5 to 30 minutes
   - **Custom Instructions** — Add team-specific review guidelines
4. Click **Save Configuration**

When you select repositories, Kilo **automatically creates webhooks** on each project.

### Step 3: Open a Merge Request

Once configured, the Review Agent automatically runs when:

| MR Event | Triggers Review |
|---|---|
| MR opened | ✅ Yes |
| New commits pushed to MR | ✅ Yes |
| MR reopened | ✅ Yes |
| Draft or WIP MR opened | ❌ Skipped |
| MR closed | ❌ No |
| MR merged | ❌ No |

## What to Expect

When a review triggers:

1. A 👀 reaction appears on the MR — this means Kilo is reviewing
2. The AI model analyzes the diff and changed files
3. The agent posts:
   - A **summary note** on the MR with overall findings
   - **Inline discussion comments** on specific lines with issues and suggestions
   - Severity tags (critical, warning, info)

### When You Push New Commits

- The previous review is **automatically cancelled** (no stale feedback)
- A new review starts for the latest commit
- If a previous summary note exists, it is **updated in place**

## How the Bot Identity Works

Review comments are posted by a **Kilo Code Review Bot** — not by your personal GitLab account. This bot is created automatically as a Project Access Token on each project.

- Created automatically the first time a project is reviewed
- Valid for 365 days and rotated automatically before expiry
- If you manually revoke the bot token in GitLab, Kilo creates a new one on the next review
- Requires **Maintainer role** on the project

## Webhooks

Kilo manages webhooks automatically:

- **Created** when you add a project to code reviews
- **Deleted** when you remove a project or disable reviews

You don't need to set up webhooks manually. If automatic webhook creation fails due to permissions, you can add the webhook manually in **GitLab → Project → Settings → Webhooks**:

- **URL**: `https://app.kilo.ai/api/webhooks/gitlab`
- **Secret token**: Available in your integration settings
- **Trigger**: Merge request events

## Disconnecting

1. Go to the GitLab integration page
2. Click **Disconnect**
3. Your tokens are cleared, but webhook configuration is preserved so reconnecting restores your setup

> Disconnecting from Kilo does not revoke OAuth tokens on GitLab's side. You can manually revoke them from **GitLab → User Settings → Applications → Authorized Applications**.

## Troubleshooting

### Reviews are not triggering

1. Verify the GitLab integration is connected and active
2. Check that the Review Agent is **enabled** in Code Reviews
3. Ensure the project is in the allowed list
4. Confirm the MR is not a draft or WIP
5. Check that a webhook exists on the GitLab project (Project → Settings → Webhooks)

### "Permission denied" or "Cannot create bot token" errors

You need **Maintainer role** on the GitLab project. Both webhook creation and bot token creation require Maintainer access or higher.

### Reviews are failing

- Check the Code Reviews page for error details
- Ensure you have sufficient Kilo Code credits
- Large MRs may time out — increase the max review time setting

### No projects listed after connecting

- Click the refresh button to sync projects from GitLab
- Ensure your GitLab account has access to the projects you expect
- The integration shows projects where you are a member

### Token expired

- **OAuth**: Tokens refresh automatically. If refresh fails, reconnect from the integration page.
- **PAT**: Create a new token in GitLab and reconnect in Kilo.

### Self-hosted connection issues

- Verify your instance URL is accessible from the internet
- Ensure HTTPS is configured
- Check that OAuth application scopes include all required scopes
- Verify the redirect URI matches: `https://app.kilo.ai/api/integrations/gitlab/callback`
