---
title: Cloud Agents
sidebar_label: Cloud Agents
---

# Cloud Agents

Cloud Agents let you run Kilo Code in the cloud from any device, without relying on your local machine. They provide a remote development environment that can read and modify your GitHub repositories, run commands, and auto-commit changes as work progresses.

---

## What Cloud Agents Enable

- Run Kilo Code remotely from a browser
- Auto-create branches and push work continuously
- Use env vars + startup commands to shape the workspace
- Work from anywhere while keeping your repo in sync

---

## Prerequisites

Before using Cloud Agents:

- **GitHub Integration must be configured**  
  Connect your account via the [Integrations tab](https://app.kilo.ai/integrations) so that Cloud Agents can access your repositories.

---

## Cost

- **Compute is free during limited beta**
    - Please provide any feedback in our Cloud Agents beta Discord channel:
        - [Kilo Discord](https://discord.gg/D2ExdEcq)
- **Kilo Code credits are still used** when the agent performs work (model usage, operations, etc.).

---

## How to Use

1. **Connect your GitHub account** in the [Integrations](https://app.kilo.ai/integrations) tab of your personal or organization dashboard.
2. **Select a repository** to use as your workspace.
3. **Add environment variables** (secrets supported) and set optional startup commands.
4. **Start chatting with Kilo Code.**

Your work is always pushed to GitHub, ensuring nothing is lost.

---

## How Cloud Agents Work

- Each user receives an **isolated Linux container** with common dev tools preinstalled (Python, Node.js, git, etc.).
- All Cloud Agent chats share a **single container instance**, while each session gets its own workspace directory.
- When a session begins:

    1. Your repo is cloned
    2. A unique branch is created
    3. Your startup commands run
    4. Env vars are injected

- After every message, the agent:

    - Looks for file changes
    - Commits them
    - Pushes to the session’s branch

- Containers are **ephemeral**:
    - Spindown occurs after inactivity
    - Expect slightly longer setup after idle periods
    - Inactive sessions are deleted after **7 days** during the beta

---

## Environment Variables & Startup Commands

You can customize each Cloud Agent session by defining:

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

---

## Perfect For

Cloud Agents are great for:

- **Remote debugging** using Kilo Code debug mode
- **Exploration of unfamiliar codebases** without touching your local machine
- **Architect-mode brainstorming** while on the go
- **Automated refactors or tech debt cleanup** driven by Kilo Code
- **Offloading CI-like tasks**, experiments, or batch updates

---

## Limitations and Guidance

- Each message can run for **up to 10 minutes**.  
  Break large tasks into smaller steps; use a `plan.md` or `todo.md` file to keep scope clear.
- **Context is not persistent across messages yet.**  
  Kilo Code does not remember previous turns; persistent in-repo notes help keep it aligned.
- **Auto/YOLO mode is always on.**  
  The agent will modify code without prompting for confirmation.
- **Saved sessions** in the sidebar are not yet shared between logins or restorable locally.
- **MCP support is coming**, but **Docker-based MCP servers will _not_ be supported**.
