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

To add another repository:

1. Open Agent Manager.
2. Select **Add Project**.
3. Choose a folder inside a Git repository.

Agent Manager registers the repository root and makes it available immediately. Adding a project does not require a separate Agent Manager trust step. VS Code workspace trust still controls whether setup and run scripts can execute.

## Persistence and project scope

- Added repositories remain in the project list across VS Code restarts.
- The default project is derived from the current workspace. It is not an added project in the persistent registry.
- Each repository has its own worktrees, sessions, sections, selection, and Agent Manager state. Repository state is stored in that repository's `.kilo/agent-manager.json` and `.kilo/worktrees/` paths.
- Switching projects keeps their state separate, so sessions and worktrees are not mixed between repositories.
- Removing an added project only removes it from Agent Manager. It does not delete the repository, its branches, or its project state.
