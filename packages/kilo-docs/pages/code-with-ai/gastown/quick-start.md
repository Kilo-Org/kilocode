---
title: "Quick Start"
description: "Get your first Gas Town running in minutes"
---

# {% $markdoc.frontmatter.title %}

This guide walks you through creating your first town, connecting a repository, and watching agents work on real code.

## Prerequisites

- A [Kilo account](https://app.kilo.ai) (free tier works)
- A GitHub repository you want agents to work on
- A GitHub Personal Access Token (recommended)

## 1. Create a Town

When you first visit Gas Town with no existing towns, you'll be taken directly into the new town onboarding flow. Give your town a name — this is just for your reference.

{% browserFrame url="app.kilo.ai/gastown" caption="The new town onboarding flow" %}
{% image src="/docs/img/gastown/gt-new-town-onboarding.png" alt="Gas Town new town onboarding flow" /%}
{% /browserFrame %}

## 2. Connect a Repository

Add a **rig** to your town. A rig is a connection to a specific repository.

1. Click **Add Rig**
2. Select your GitHub repository (or paste the URL)
3. Choose the default branch (usually `main`)
4. Click **Connect**

Gastown uses the [Kilo GitHub App](https://github.com/apps/kilo-code) to access your repository. You'll be prompted to install it if you haven't already.

{% browserFrame url="app.kilo.ai/gastown/town/rigs/new" caption="Adding a new rig — connect your repository" %}
{% image src="/docs/img/gastown/gt-new-rig.png" alt="Gas Town new rig creation flow" /%}
{% /browserFrame %}

## 3. Add a GitHub Personal Access Token

{% callout type="tip" title="Recommended" %}
Adding a GitHub PAT means all commits, branches, and PRs created by your town's agents will appear as **you** — not a bot account. It also enables agents to use `gh` CLI commands (creating issues, commenting on PRs, etc.) on your behalf.
{% /callout %}

1. Go to **Town Settings** → **Git & Authentication**
2. Generate a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) scoped to the repository your town is connected to
3. Required permissions: **Contents** (read/write), **Pull requests** (read/write), **Metadata** (read)
4. Optional: add **Actions** (read/write) if your repo uses GitHub Actions workflows
5. Paste the token and save

{% callout type="info" %}
Use a fine-grained token scoped to only the repository your town works on. Since agents act autonomously on your behalf, limiting the token's scope reduces risk.
{% /callout %}

Without a PAT, agents use the GitHub App installation token — functional but shows up as a bot in your git history.

## 4. Sling Your First Task

Now let's give the agents something to do. The easiest way is to ask the Mayor:

> *"Add a CONTRIBUTING.md file with basic setup instructions"*

Or use the **Sling Work** action in the town header to describe the task directly.

## 5. Watch Agents Work

The reconciler assigns your task to an available polecat agent. Head to the **rig page** to watch it in action:

1. A **bead** appears in the kanban board's open column
2. It moves to `in_progress` as a polecat picks it up
3. The agent reads your code, makes changes, and pushes a branch
4. The bead moves to `in_review` as the refinery checks the work
5. The refinery merges (or creates a PR depending on your settings)
6. The bead lands in the `closed` column

{% browserFrame url="app.kilo.ai/gastown/town/rigs/main" caption="The rig page — convoy tracker and kanban board showing beads in various states" %}
{% image src="/docs/img/gastown/gt-rig-page-convoy-in-progress.png" alt="Gas Town rig page with an active convoy and beads in progress" /%}
{% /browserFrame %}

The whole cycle typically takes 2-10 minutes depending on complexity and the model you're using.

## 6. Talk to the Mayor

Click the **Mayor** chat to interact with your town's coordinator. Try:

- *"What's the status of the town?"*
- *"Create a convoy to add unit tests for the auth module"*
- *"What settings should I change for faster reviews?"*

The Mayor is always running — it's your primary interface for managing the town conversationally.

{% browserFrame url="app.kilo.ai/gastown/town" caption="The Mayor — your conversational interface to the town" %}
{% image src="/docs/img/gastown/gt-town-overview.png" alt="Gas Town overview with Mayor chat" /%}
{% /browserFrame %}

## What's Next?

- [Concepts](/docs/code-with-ai/gastown/concepts) — Understand the building blocks in depth
- [Sling Work](/docs/code-with-ai/gastown/sling-work) — Learn about convoys and multi-step workflows
- [Settings](/docs/code-with-ai/gastown/settings) — Configure models, merge strategies, and agent behavior
