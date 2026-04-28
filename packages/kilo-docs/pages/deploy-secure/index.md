---
title: "Deploy & Secure"
description: "Deploy applications and manage security with Kilo Code"
---

# {% $markdoc.frontmatter.title %}

{% callout type="generic" %}
Deploy your applications directly from Kilo Code and manage security with AI-powered reviews and scans.
{% /callout %}

## Deploy

Ship your applications with one-click deployment:

- [**Deploy**](/docs/deploy-secure/deploy) — Deploy Next.js and static sites
- One-click deployment from the dashboard
- Automatic rebuilds on GitHub push
- Deployment history with rollback support

### Supported Platforms

- **Next.js 14, 15, 16** — Latest versions with partial support for v16
- **Static Sites** — Pre-built HTML/CSS/JS
- **Static Site Generators** — Hugo, Jekyll, Eleventy
- **Package managers** — npm, pnpm, yarn, bun (auto-detected)

### Deployment Features

- GitHub integration for automatic rebuilds
- Environment variables and secrets support
- Real-time log streaming
- Deployment history with one-click rollbacks

## Managed Indexing

Fast, scalable code indexing for better AI context:

- [**Managed Indexing**](/docs/deploy-secure/managed-indexing) — Cloud-based code indexing
- Improved context for large codebases
- Faster initial indexing times
- Reduced local resource usage

## Security Reviews

AI-powered dependency vulnerability triage for your codebase:

- [**Security Reviews**](/docs/deploy-secure/security-reviews) — Contextualize Dependabot alerts with AI
- Syncs your Dependabot alerts and triages them automatically
- Deep codebase analysis to determine if CVEs are actually reachable
- Auto-dismiss non-exploitable findings and sync back to GitHub

### Security Features

- **Automated triage** — AI classifies each alert as Safe to Dismiss, Needs Analysis, or Needs Review
- **Deep analysis** — Full codebase search to check if vulnerable code paths are reachable
- **Auto-dismiss** — Automatically close non-exploitable findings with configurable confidence thresholds
- **SLA tracking** — Set remediation deadlines per severity and monitor compliance

## Get Started

1. Enable [GitHub Integration](/docs/deploy-secure/deploy#prerequisites) for deployments
2. Set up your first [deployment](/docs/deploy-secure/deploy) in the dashboard
3. Configure [managed indexing](/docs/deploy-secure/managed-indexing) for large projects
4. Enable the [Security Agent](/docs/deploy-secure/security-reviews) to triage your Dependabot alerts

## Best Practices

- **Deploy early** — Start with a staging deployment to verify the setup
- **Use environment variables** — Keep secrets out of your codebase
- **Enable automatic rebuilds** — Push to GitHub and deploy automatically
- **Triage Dependabot alerts** — Let the Security Agent determine which CVEs are actually exploitable
- **Set SLA deadlines** — Track remediation timelines per severity level
