---
title: "Multi-project Agent Manager"
description: "Manage Agent Manager sessions across multiple Git repositories"
---

# Multi-project Agent Manager

Agent Manager lets you manage sessions and worktrees from multiple Git repositories in one panel. Multi-project support is always available, with no experimental setting required.

## Add Git repositories

The repository in your current VS Code workspace is always the **default project** and appears first in the project list. You cannot remove it from Agent Manager. Its existing sessions, worktrees, and sections remain available.

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
