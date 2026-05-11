---
title: "Settings"
description: "Configure models, merge strategies, and agent behavior"
---

# {% $markdoc.frontmatter.title %}

Gas Town settings control how your agents behave — which models they use, how they review code, and how they interact with your repositories.

Access settings from your town dashboard → **Settings**.

## Models

### Default Model

The primary model used by all agents (polecats, refinery, mayor). This affects quality, speed, and cost.

Popular choices:
- **Kilo Auto Frontier** — highest quality models, best results (recommended)
- **Kilo Auto Balanced** — good balance of quality and cost (minimum for Gas Town)

### Role-Specific Models

Override the default model for specific agent roles. By default, all roles use the town-level model. You can override per-role if you want to optimize cost vs quality for different tasks (e.g., a faster model for the mayor, a stronger model for the refinery).

### Small Model

Used for lightweight tasks (classification, routing, summarization). Usually a smaller, cheaper model.

## Git & Authentication

### GitHub Personal Access Token

{% callout type="tip" title="Strongly Recommended" %}
Adding a GitHub PAT ensures that all commits, branches, and PRs created by your agents appear as **you** in git history. Without it, activity shows up under the Kilo GitHub App bot account.
{% /callout %}

**To add a PAT:**
1. Go to **Settings** → **Git & Authentication**
2. Generate a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) scoped to the connected repository
3. Required permissions: **Contents** (read/write), **Pull requests** (read/write), **Metadata** (read)
4. Optional: add **Actions** (read/write) if your repo uses GitHub Actions workflows
5. Paste the token and save

{% callout type="info" %}
Use a fine-grained token limited to only the repository your town is connected to. Agents act autonomously on your behalf, so limiting scope is a best practice.
{% /callout %}

**What the PAT enables:**
- Commits and PRs appear as you (your avatar, your username)
- Agents can use `gh` CLI commands on your behalf
- Access to the specific repository you scoped the token to
- Ability to trigger CI workflows (if Actions permission is granted)

**Without a PAT:**
- The GitHub App installation token is used (functional but less personal)
- PRs show as created by the Kilo bot
- Some `gh` CLI operations may not work

### GitHub App Installation

The [Kilo GitHub App](https://github.com/apps/kilo-code) provides base-level repository access. It's installed per-organization or per-repository and gives agents read/write access to code, PRs, and issues.

The GitHub App is **required** — it's how Gastown gets installation tokens for cloning and pushing. The PAT is **optional but recommended** — it provides user-level attribution.

## Merge Strategy

Controls how reviewed code lands in your repository:

| Strategy | Behavior | Best for |
|---|---|---|
| `direct` | Refinery merges directly (no PR) | Speed, trusted environments |
| `pr` | Refinery creates a PR | Audit trail, team visibility, CI integration |

For `pr` mode, you can also configure:
- **Auto-merge** — PRs merge automatically after refinery approval
- **Require human approval** — PRs wait for a human reviewer

## Refinery Configuration

### Review Mode

| Mode | Behavior |
|---|---|
| `always` | Every completed bead goes through review (default, recommended) |
| `never` | Skip review entirely — merge on polecat completion |
| `pr_only` | Only review work that generates a PR |

### Review Gates

Strictness level from 1 (lenient) to 5 (strict). Higher levels mean the refinery will reject more frequently but produce higher quality output.

### Max Review Cycles

How many write → review → revise cycles before a bead fails and escalates. Default: 3.

## Agent Limits

### Max Polecats Per Rig

How many coding agents can work simultaneously on a single rig. Default: 2.

Higher values mean more parallel work but also more resource consumption. Consider:
- **1-2** — conservative, good for small repos or limited budgets
- **3-4** — moderate parallelism, good for medium projects
- **5+** — aggressive, best for large repos with lots of independent work

### Alarm Intervals

Controls how frequently the reconciler checks for work:
- **Active interval** — when agents are working (default: 5s)
- **Idle interval** — when no work is pending (default: 60s)

Lower active intervals mean faster response to events but more compute usage.

## Environment Variables

Add environment variables that are available to all agents in the container. Useful for:
- API keys for external services agents might test against
- Database connection strings for test environments
- Feature flags or configuration values

{% callout type="warning" %}
Environment variables are visible to all agents in the town. Do not store production secrets here — use test/development credentials only.
{% /callout %}

## Custom Instructions

Free-form text injected into every agent's system prompt. Use this to communicate:

- Project conventions: *"Always use TypeScript strict mode"*
- Architecture decisions: *"The auth module uses JWT with RS256. Never use HS256."*
- Style preferences: *"Use functional components with hooks, never class components"*
- Constraints: *"Do not modify files in the `vendor/` directory"*
- Testing requirements: *"Every new function must have a corresponding unit test"*

Custom instructions are powerful — they let you encode institutional knowledge that agents follow consistently.

## Convoy Settings

### Staged Convoys Default

When `true`, new convoys are created as staged (paused until you un-stage). Default: `true`.

### Convoy Merge Mode

| Mode | Behavior |
|---|---|
| `review-then-land` | Each bead merges to a feature branch, then a landing review merges to main (default) |
| `review-and-merge` | Each bead goes through review and merges directly to main (no feature branch) |

`review-then-land` provides the strongest quality guarantees but takes longer. Use `review-and-merge` for simpler tasks or when you want immediate feedback.

## Per-Rig Overrides

Any town-level setting can be overridden at the rig level. This lets you:
- Use a more powerful model for a complex repository
- Set stricter review gates for a production codebase
- Allow more polecats on a repo with many independent modules
- Disable review for a documentation-only repo

Access per-rig settings from the rig detail page → **Settings**.
