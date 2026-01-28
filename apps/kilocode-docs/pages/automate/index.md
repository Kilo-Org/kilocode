---
title: "Automate"
description: "Automate your development workflows with Kilo Code"
---

# {% $markdoc.frontmatter.title %}

{% callout type="generic" %}
Automate repetitive tasks, set up AI-powered code reviews, and extend Kilo Code's capabilities with integrations and MCP servers.
{% /callout %}

## Code Reviews

Automated AI code reviews for every pull request:

- [**Code Reviews**](/docs/automate/code-reviews) — AI-powered PR reviews
- Automated analysis on PR open/update
- Customizable review styles (Strict, Balanced, Lenient)
- Focus areas: Security, Performance, Bug Detection, Style, Tests, Documentation

## Agent Manager

Manage and orchestrate multiple AI agents:

- [**Agent Manager**](/docs/automate/agent-manager) — Control panel for running agents
- Local and cloud-synced sessions
- Parallel Mode with Git worktree isolation
- Resume existing sessions

## MCP (Model Context Protocol)

Connect Kilo Code to external tools and services:

- [**MCP Overview**](/docs/automate/mcp/overview) — Introduction to the Model Context Protocol
- [**What is MCP?**](/docs/automate/mcp/what-is-mcp) — Understanding MCP architecture
- [**Using MCP in Kilo Code**](/docs/automate/mcp/using-in-kilo-code) — Configuration guide
- [**STDIO & SSE Transports**](/docs/automate/mcp/server-transports) — Local and remote server options
- [**MCP vs API**](/docs/automate/mcp/mcp-vs-api) — When to use MCP
- [**Using MCP in CLI**](/docs/automate/mcp/using-in-cli) — CLI-specific MCP setup

## Integrations

Connect Kilo Code with your development tools:

- [**Integrations**](/docs/automate/integrations) — Available integrations overview
- GitHub integration for deployments and code reviews
- GitHub Actions for CI/CD workflows
- Custom integrations via MCP

## Extending Kilo

Customize and extend Kilo Code's capabilities:

- [**Local Models**](/docs/automate/extending/local-models) — Run local AI models
- [**Shell Integration**](/docs/automate/extending/shell-integration) — Shell command integration
- [**Auto-Launch**](/docs/automate/extending/auto-launch) — Automatic agent startup

## Common Automation Patterns

- **PR-triggered reviews** — Automatically review code on every pull request
- **Scheduled scans** — Run security or code quality scans on a schedule
- **CI/CD integration** — Integrate with GitHub Actions and other CI systems
- **Custom MCP servers** — Build your own tools and integrations

## Get Started

1. Set up the [Agent Manager](/docs/automate/agent-manager) for local automation
2. Configure [MCP servers](/docs/automate/mcp/using-in-kilo-code) for external integrations
3. Enable [Code Reviews](/docs/automate/code-reviews) for your repositories
4. Explore [integrations](/docs/automate/integrations) to connect your toolchain
