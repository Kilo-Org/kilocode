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

The project footer offers three ways to bring in another repository: **New project...**, and the **Add project...** menu with **Open local folder...** and **Clone repository...**. None of them change the folders open in the VS Code window, and all require a trusted workspace.

### New project

A new project starts an empty Git repository without leaving Agent Manager.

1. Open Agent Manager and select **New project...** below the project list.
2. Enter a project name and choose a **Parent folder**.
3. Select **Create project**.

Kilo creates the folder, initializes Git, and writes an empty bootstrap commit so the project has a starting branch. The commit is unsigned and skips normal commit hooks, and it does not read or stage any existing files. Only committed files appear in new worktrees.

### Open local folder

Use this to adopt a folder that already exists on disk.

1. Select **Add project...**, then **Open local folder...**.
2. Choose the folder.

An existing Git repository is registered as it is. A plain folder is attached only after you confirm that Kilo should initialize Git and create the empty bootstrap commit. If the repository has no usable Git identity, Kilo asks for a name and email and saves them only in that repository.

### Clone repository

Cloning runs through VS Code's Git integration, so it reuses your existing credentials, SSH agent, progress, and cancellation instead of spawning its own `git clone`.

1. Select **Add project...**, then **Clone repository...**.
2. Enter the repository URL and choose a **Parent folder**.
3. Select **Clone repository**.

If the destination already corresponds to a registered project, Kilo opens the existing project instead of cloning it again. If a checkout fails partway (for example with Git LFS) but a valid repository remains at the destination, you can still attach it.

Agent Manager registers the repository root and makes it available immediately. Adding a project does not require a separate Agent Manager trust step. VS Code workspace trust still controls whether setup and run scripts can execute.

## Persistence and project scope

- Added repositories remain in the project list across VS Code restarts.
- The default project is derived from the current workspace. It is not an added project in the persistent registry.
- Each repository has its own worktrees, sessions, sections, selection, and Agent Manager state. Repository state is stored in that repository's `.kilo/agent-manager.json` and `.kilo/worktrees/` paths.
- Switching projects keeps their state separate, so sessions and worktrees are not mixed between repositories.
- Removing an added project only removes it from Agent Manager. It does not delete the repository, its branches, or its project state.
