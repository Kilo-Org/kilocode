---
title: "Multi-project Agent Manager"
description: "Manage Agent Manager sessions across multiple Git repositories"
---

# Multi-project Agent Manager

Multi-project Agent Manager lets you manage sessions and worktrees from multiple Git repositories in one Agent Manager panel. The feature is experimental and disabled by default. When it is disabled, Agent Manager keeps its existing single-project behavior.

One Agent Manager project represents one canonical Git repository. A project is not a collection of repositories, and the VS Code workspace folder does not define a project.

## Enable multi-project mode

1. Open [Kilo Code Settings](/docs/getting-started/settings#experimental-features).
2. Open the **Experimental** tab.
3. Enable **Multi-Project Agent Manager**.

The setting is also available as `kilo-code.new.experimental.multiProject`. It is an application-scoped VS Code setting and defaults to `false`.

## Default project

The first folder in your VS Code workspace is always the **default project**. Agent Manager derives it from the current workspace folder at run time, so it is not an entry in the saved project list and you cannot remove it. It appears first in the **PROJECTS** list, and it has its own Local context, worktrees, sections, sessions, scripts, and settings like any other project.

If the workspace folder is not a Git repository, Agent Manager still uses it as the default project. See [When the workspace folder is not a Git repository](#when-the-workspace-folder-is-not-a-git-repository).

## Add repositories

The project footer below the list provides these actions:

- **New project...** creates a new folder, initializes a Git repository in it, and adds the repository as a project. The parent folder must not be inside an existing Git repository.
- **Add project...** opens a menu with two actions:
  - **Open local folder...** opens a folder picker. Agent Manager resolves the selected folder to its canonical Git repository root and adds that repository. A folder inside an existing repository attaches that repository, and a linked worktree attaches its primary checkout.
  - **Clone repository...** clones a repository with the VS Code Git extension into a parent folder that you choose, then adds it.

Multi-project mode must be enabled and the VS Code window must be trusted before you can add, create, or clone a repository. Adding a repository does not add it to `vscode.workspaceFolders`. Agent Manager identifies a project by its canonical Git root, so adding the same repository again opens the existing project instead of creating a duplicate.

If you select a folder that is not a Git repository, **Open local folder...** asks whether to initialize Git and create an empty first commit before it adds the project.

## Project scope

Each project keeps its own state:

- A **Local** context and Local sessions, scoped to that repository's root
- Managed worktrees under `.kilo/worktrees/` in that repository
- Sections, worktree order, tab layout, and the other sidebar state
- Setup script, run script, and Agent Manager settings for that repository
- Agent Manager state in that repository's `.kilo/agent-manager.json`

Sessions, worktrees, and sections are not shared between projects. Removing an added project removes it from Agent Manager only. It does not delete the repository, its branches, or its state.

## When the workspace folder is not a Git repository

Agent Manager does not check that the first workspace folder is a Git repository before using it as the default project. It keeps that folder as the default project and does not show a not-a-repository empty state for it.

Because the folder is not a repository, worktree actions on the default project fail with:

> This folder is not a git repository. Initialize a repository or open a git project to use worktrees.

You can still work with repositories inside a non-Git parent folder:

1. Open the parent folder in VS Code.
2. Add each child repository with **Add project... > Open local folder...**.
3. Use each added repository as its own project with its own Local context, worktrees, sections, scripts, and settings.

The parent folder stays the default project and worktree actions on it keep failing. Open a Git repository as the workspace folder when you do not need the parent-folder layout.
