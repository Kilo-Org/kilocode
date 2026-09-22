---
title: "Multi-project Agent Manager"
description: "Manage Agent Manager sessions across multiple Git repositories"
---

# Multi-project Agent Manager

Multi-project Agent Manager lets you manage sessions and worktrees from multiple Git repositories in one Agent Manager panel. The feature is experimental and disabled by default. When it is disabled, Agent Manager keeps its existing single-project behavior.

## Enable multi-project mode

1. Open [Kilo Code Settings](/docs/getting-started/settings#experimental-features).
2. Open the **Experimental** tab.
3. Enable **Multi-Project Agent Manager**.

The setting is also available as `kilo-code.new.experimental.multiProject`. It is an application-scoped VS Code setting and defaults to `false`.

## Add Git repositories

The repository in your current VS Code workspace is always the **default project**. You cannot remove it from Agent Manager.

Project actions are at the bottom of the project list. **New project...** creates a repository. **Add project...** opens a menu with **Open local folder...** and **Clone repository...**.

| Action | What it does |
|---|---|
| **New project...** | Creates a folder in the parent you choose, initializes Git in it, and registers the project. |
| **Open local folder...** | Adopts an existing folder. If the folder is not already a Git repository, Agent Manager asks before initializing Git. |
| **Clone repository...** | Clones a repository URL into the parent you choose and registers the project. |

When Agent Manager initializes a repository, or opens an existing repository that has no commits yet, it creates an empty, unsigned bootstrap commit that skips the normal commit hooks. The commit does not include existing or uncommitted files, and only committed files appear in new worktrees. Creating that commit needs a Git identity, so if the repository has none, Agent Manager asks for a name and email and saves them only in that repository's local Git configuration. If you decline, the folder stays on disk but is not added as a project.

Cloning uses VS Code's built-in Git command, so it reuses your VS Code Git credentials, SSH agent, progress, and cancellation. It requires VS Code 1.111 or later with the built-in Git extension enabled; use **Open local folder...** on older versions. If the repository is already registered, or a checkout already exists at the destination, Agent Manager opens the existing project instead of cloning it again. If the clone succeeds but the checkout fails, for example on a missing Git LFS object, you can still attach the repository at the destination.

Agent Manager registers the repository root and makes it available immediately. Adding a project does not require a separate Agent Manager trust step. VS Code workspace trust still controls whether setup and run scripts can execute.

## Persistence and project scope

- Added repositories remain in the project list across VS Code restarts.
- The default project is derived from the current workspace. It is not an added project in the persistent registry.
- Each repository has its own worktrees, sessions, sections, selection, and Agent Manager state. Repository state is stored in that repository's `.kilo/agent-manager.json` and `.kilo/worktrees/` paths.
- Switching projects keeps their state separate, so sessions and worktrees are not mixed between repositories.
- Removing an added project only removes it from Agent Manager. It does not delete the repository, its branches, or its project state.
