---
title: "GitHub Integration"
description: "Connect a GitHub account to your KiloClaw agent for repository access"
---

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
