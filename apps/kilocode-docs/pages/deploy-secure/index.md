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

AI-powered security analysis for your code and dependencies:

- [**Security Reviews**](/docs/deploy-secure/security-reviews) — Comprehensive security scanning
- Dependency vulnerability contextualization
- Code-level taint analysis (SQL injection, XSS, command injection)
- Integration with existing security tools (Dependabot, npm audit)

### Security Features

- **PR-triggered analysis** — Automatic security review on pull requests
- **Scheduled full scans** — Periodic repository-wide analysis
- **Dependency contextualization** — Determine if vulnerabilities are actually exploitable
- **Historical tracking** — Track security posture over time

### Focus Areas

- **Security Vulnerabilities** — SQL injection, XSS, unsafe APIs
- **Performance Issues** — N+1 queries, inefficient loops
- **Bug Detection** — Logic errors, edge-case failures
- **Code Style** — Formatting, naming, readability
- **Test Coverage** — Missing or inadequate tests
- **Documentation** — Missing comments, unclear APIs

## Get Started

1. Enable [GitHub Integration](/docs/deploy-secure/deploy#prerequisites) for deployments
2. Set up your first [deployment](/docs/deploy-secure/deploy) in the dashboard
3. Configure [managed indexing](/docs/deploy-secure/managed-indexing) for large projects
4. Enable [security reviews](/docs/deploy-secure/security-reviews) for your repositories

## Best Practices

- **Deploy early** — Start with a staging deployment to verify the setup
- **Use environment variables** — Keep secrets out of your codebase
- **Enable automatic rebuilds** — Push to GitHub and deploy automatically
- **Run security scans** — Review security findings before merging PRs
- **Track your security posture** — Monitor trends over time
