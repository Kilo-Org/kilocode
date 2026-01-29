---
title: "Cline to Kilo: Contributor Migration Guide"
description: "A guide for Cline contributors who want to start contributing to Kilo Code"
---

# Cline to Kilo: Contributor Migration Guide

If you've been contributing to Cline and you're ready to bring those skills over to Kilo Code, you're in the right place. This guide will walk you through what's different, what's the same, and how to get up and running as a Kilo contributor.

The good news: if you've been contributing to Cline, you already have most of the skills you need. The workflows are similar, but there are some differences worth knowing about before you dive in.

## The Quick Version

| What You Know from Cline                     | What's Different in Kilo |
| -------------------------------------------- | ------------------------ |
| `npm run install:all`                        | `pnpm install`           |
| `npm run protos` required before first build | Not required             |
| F5 to launch dev extension                   | Same — F5 to launch      |
| Changesets for versioning                    | Same — `pnpm changeset`  |

## Setting Up Your Environment

### What Stays the Same

- Git, Node.js (v20.18.1+), and VS Code are still your core tools
- F5 still launches the extension in debug mode
- The project structure follows similar patterns (`src/`, `webview-ui/`, `e2e/`)

### What's Changed

**Package Manager: pnpm instead of npm**

Kilo uses pnpm for dependency management. If you don't have it installed:

```bash
npm install -g pnpm
```

Then instead of:

```bash
# Cline
npm run install:all
```

You'll run:

```bash
# Kilo
pnpm install
```

This single command handles everything — the main extension, webview UI, and e2e tests.

**No Protocol Buffer Generation**

In Cline, you needed to run `npm run protos` before your first build. Kilo doesn't require this step. Just install dependencies and you're ready to go.

**Building the Extension**

```bash
pnpm build
```

This builds the webview UI, compiles TypeScript, bundles everything, and drops a `.vsix` file in `bin/`.

## Development Workflow Differences

### Hot Reloading

Kilo has improved hot reloading in development mode:

- **Webview UI changes:** Apply immediately without restart (same as Cline)
- **Core extension changes:** In dev mode (`NODE_ENV="development"`), Kilo automatically triggers `workbench.action.reloadWindow` — no manual debugger restarts needed

In Cline, you had to manually stop debugging, kill background tasks, and restart. Kilo handles this for you during development.

**Note:** Production builds still require the manual stop/restart cycle.

### Git Hooks

Kilo uses Husky for git hooks, which run automatically:

**Pre-commit:**

- Blocks commits directly to main
- Runs type generation (`pnpm generate-types`)
- Checks for type file changes
- Runs lint-staged

**Pre-push:**

- Blocks pushes directly to main
- Compiles the project
- Reminds you to create a changeset if needed

These hooks catch issues early. If a commit or push fails, check the hook output for details.

## Testing

### Running Tests

```bash
# All tests
pnpm test

# Extension tests only
pnpm test:extension

# Webview tests only
pnpm test:webview

# E2E / Integration tests
pnpm test:integration
```

### E2E Test Setup

For integration tests, create a `.env.local` file in the project root:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

Check `e2e/VSCODE_INTEGRATION_TESTS.md` for full details.

## Contributing Code

### Creating a Pull Request

The changeset workflow is identical to Cline:

```bash
pnpm changeset
```

Choose your version bump:

- **major** — breaking changes
- **minor** — new features
- **patch** — bug fixes

Commit the generated `.changeset` file with your changes.

### Code Quality Checks

```bash
pnpm lint          # ESLint
pnpm check-types   # TypeScript type checking
```

## What's New in Kilo

Beyond the workflow changes, Kilo has expanded significantly as a platform. As a contributor, you might find opportunities to work on:

- **Multiple interfaces:** VS Code, JetBrains, CLI, and web (Cloud Agents, App Builder)
- **Specialized Agent modes:** Code, Ask, Debug, Architect, Orchestrator
- **Custom Modes:** A system for creating and sharing specialized agent configurations
- **Platform features:** Sessions, Parallel Agents, Deploy, Code Reviews, Managed Indexing
- **Kilo Marketplace:** A community-driven repository where you can contribute Skills (modular workflows), MCP Servers (tool integrations), and Modes (custom agent behaviors)

Check the [Architecture Overview](/contributing/architecture) to understand how these pieces fit together.

## Getting Help

- **Discord:** Real-time support from the community
- **GitHub Discussions:** For questions and feature ideas
- **Reddit:** Community discussions

## TL;DR Checklist

- ✅ Install pnpm globally
- ✅ Fork and clone the Kilo repo
- ✅ Run `pnpm install` (not `npm run install:all`)
- ✅ Skip the protos step — it's not needed
- ✅ Press F5 to launch the dev extension
- ✅ Create a changeset before your PR (`pnpm changeset`)
- ✅ Let the git hooks do their thing

Welcome to Kilo. We're glad you're here.
