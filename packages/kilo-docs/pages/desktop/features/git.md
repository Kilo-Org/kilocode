---
title: "Git integration"
description: "Review your uncommitted changes, switch branches, and run sessions in a new or existing worktree, without leaving the chat in Kilo Desktop."
---

# Git integration

Review your changes and manage branches for the chat's workspace without leaving the conversation. Git integration uses your system `git`, so make sure Git 2.17 or newer is installed and on your `PATH`.

## Review changes

The **Changes** tab shows the diff of your uncommitted work against the last commit. Each file is a section you can expand or collapse, labeled with its path, a status icon (added, modified, or deleted), and its own added and removed counts. The diff refreshes on its own as the working tree changes.

The **git diff tracker** in the top toolbar summarizes those changes at a glance — the number of changed files with added (green) and removed (red) line counts — and opens the **Changes** tab when you select it.

Controls at the top of the tab let you:

- {% svgIcon src="/docs/img/desktop/list-chevrons-down-up.svg" /%} **Collapse all files** to their headers, then expand just the ones you want.
- {% svgIcon src="/docs/img/desktop/settings.svg" /%} **Diff settings** control how diffs are displayed, such as switching between a unified and split layout.
- {% svgIcon src="/docs/img/desktop/panel-right-close.svg" /%} **Hide file tree** to give the diff more room, and show it again when you need it; Kilo Desktop remembers your choice. Select a file in the file tree to jump to it in the diff.

The tab also handles the cases where there's nothing to show:

- **No changes** — a clean working tree shows an empty state.
- **Not a git repository** — offers to [initialize git](#set-up-git-for-a-folder) for the folder.
- **Diff too large** — pauses live updates with an option to load it on demand.

## Commit, push, and open a pull request

The commit control in the top toolbar turns your changes into commits and shares them. Its main button adapts to your branch's state and offers the next step: **Commit**, **Commit & push**, **Commit, push & PR**, **Push**, **Pull**, **Create PR**, or **View PR**. Open its dropdown to choose **Commit**, **Push**, or **Create PR** directly.

- **Commit** — stages all your changes and commits them. Kilo writes a one-line commit message using the model selected in the chat, matching your repository's recent commit style. Unavailable when the working tree is clean.
- **Push** — pushes your commits to the remote. It needs a checked-out branch with an `origin` remote and local commits to send.
- **Create PR** — writes a pull request title and description with the selected model, creates a **draft** pull request, and opens it in your browser. If your repository has a PR template, Kilo fills it in. It needs the GitHub CLI (`gh`), committed work on a feature branch, and a GitHub `origin` remote. When a pull request already exists, the menu links to it as **PR #N**, colored by its state.

While an action runs, the button shows its progress (for example *Generating commit message...* or *Creating draft PR...*). If the button is disabled, hover it to see why (for example *Branch is behind its upstream. Pull or rebase first.*). Select a model in the chat before committing.

If a push fails, the error opens in a dialog where you can read the full git output. Select **Fix in chat** to add the error to your chat draft so the agent can help.

## Switch and create branches

A branch switcher in the chat lets you move between branches for the workspace. The list is grouped into your **default**, **recent**, and **other** branches, and you can search it. Selecting a branch checks it out; choosing a remote branch creates a local tracking branch for it.

If the branch you pick is already checked out in another worktree, Kilo Desktop switches the session to that worktree instead of checking the branch out again; if it's checked out in your main repository, the session switches to **Local**.

When the session uses an existing worktree that other sessions also use, Kilo Desktop asks **Switch branch in this worktree?** before changing its branch, because the change affects those sessions too. Select **Switch anyway** to continue, or **Cancel**.

To start new work, create a branch from the switcher. You can base the new branch on your current branch or on the repository's default branch, and it's checked out as soon as it's created.

## Work locally or in a worktree

Beside the workspace in the chat, a mode control sets where a session's changes go:

- **Local repository** — work in the repository already on your machine, on whatever branch is checked out. This is the default.
- **New worktree** — create a separate copy for the session, based on a branch you pick, so your main checkout stays untouched while the agent works. It's unavailable until the repository has at least one commit.
- **Existing worktrees** — run the session in a worktree that's already there, such as one an earlier session created. Search the list by worktree name or branch. This submenu appears only when the workspace has other worktrees.

The control shows **Local**, **New worktree**, or the name of the worktree you picked. Kilo Desktop remembers whether you last chose **Local repository** or **New worktree** and uses that choice for new sessions in every workspace, including after a restart. An existing worktree applies only to the session you're starting. Worktree sessions created in Kilo Desktop also appear in the [VS Code extension](/docs/code-with-ai/platforms/vscode)'s Agent Manager.

## Set up git for a folder

If the workspace folder isn't a git repository yet, the Changes tab offers an **Initialize Git** action to create one, after which the diff and branch tools become available.

The branch switcher appears for regular repositories. For repositories that can't be used safely — bare, unsafe, or with no commits yet — Kilo Desktop shows a short explanation instead of a broken or misleading control.
