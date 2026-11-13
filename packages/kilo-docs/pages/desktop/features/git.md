---
title: "Git integration"
description: "Review your uncommitted changes, commit and open pull requests, pick a branch, and run sessions in a new or existing worktree in Kilo Desktop."
---

# Git integration

Review your changes and manage branches for the chat's workspace without leaving the conversation. Git integration uses your system `git`, so make sure Git 2.17 or newer is installed and on your `PATH`.

## Review changes

The **Changes** tab shows the diff of your uncommitted work against the last commit. Each file is a section you can expand or collapse, labeled with its path, a status icon (added, modified, or deleted), and its own added and removed counts. The diff refreshes on its own as the working tree changes.

The **git diff tracker** in the top toolbar summarizes those changes at a glance — the number of changed files with added (green) and removed (red) line counts — and opens the **Changes** tab when you select it. Hover it to see *Approximate changes since the last commit.*

Controls at the top of the tab let you:

- {% svgIcon src="/docs/img/desktop/list-chevrons-down-up.svg" /%} **Collapse all files** to their headers, then expand just the ones you want.
- {% svgIcon src="/docs/img/desktop/settings.svg" /%} **Diff settings** control how diffs are displayed, such as switching between a unified and split layout.
- {% svgIcon src="/docs/img/desktop/panel-right-close.svg" /%} **Hide file tree** to give the diff more room, and show it again when you need it; Kilo Desktop remembers your choice. Select a file in the file tree to jump to it in the diff.

Hover a file's header for **Copy path**, which copies its path in the repository, and **Open file**, which opens it in the Files tab. **Open file** isn't offered for deleted files.

The tab also handles the cases where there's nothing to show:

- **No changes** — a clean working tree shows an empty state.
- **Not a git repository** — offers to [initialize git](#set-up-git-for-a-folder) for the folder.
- **Diff too large** — Kilo Desktop shows the diff's size and pauses live updates. Select **Show anyway** to load the full diff, or **Reload** to check again.

## Commit, push, and open a pull request

The commit control in the top toolbar turns your changes into commits and shares them. Its main button adapts to your branch's state and offers the next step: **Commit**, **Commit & push**, **Commit, push & PR**, **Push**, **Pull**, **Create PR**, or **View PR**. Open its dropdown to choose **Commit**, **Push**, or **Create PR** directly.

- **Commit** — stages all your changes and commits them. Kilo writes a one-line commit message using the model new chats start with (the one you last picked), matching your repository's recent commit style. Unavailable when the working tree is clean.
- **Push** — pushes your commits to the remote. It needs a checked-out branch with an `origin` remote and local commits to send.
- **Create PR** — writes a pull request title and description with the same model, creates a **draft** pull request, and opens it in your browser. If your repository has a PR template, Kilo fills it in. It needs the GitHub CLI (`gh`), committed work on a feature branch, and a GitHub `origin` remote. When a pull request already exists, the menu links to it as **PR #N**, colored by its state.

While an action runs, the button shows its progress (for example *Generating commit message...* or *Creating draft PR...*). If the button is disabled, hover it to see why (for example *Branch is behind its upstream. Pull or rebase first.*).

If a push fails, the error opens in a dialog where you can read the full git output. Select **Fix in chat** to add the error to your chat draft so the agent can help.

## Switch and create branches

On the [New Session page](/docs/desktop/quickstart#start-a-session), the **Branch** field lets you switch branches for the folder the session will work in. The list is grouped into **Default Branch**, **Recent Branches**, and **Other Branches**, and you can search it. Selecting a branch checks it out; choosing a remote branch creates a local tracking branch for it. In an open chat, the current branch is shown under the message box.

If the branch you pick is already checked out in another worktree, Kilo Desktop sets **Use** to that worktree instead of checking the branch out again; if it's checked out in your main repository, **Use** switches to **Local repository**.

When the session uses an existing worktree that other sessions also use, Kilo Desktop asks **Switch branch in this worktree?** before changing its branch, because the change affects those sessions too. Select **Switch anyway** to continue, or **Cancel**.

To start new work, select **Create branch** in the branch list. When your current branch differs from the repository's default branch, choose which one to base it on under **Create branch based on…**. The new branch is checked out as soon as it's created.

## Work locally or in a worktree

On the New Session page, next to **Workspace**, the **Use** field sets where a new session's changes go:

- **Local repository** — work in the repository already on your machine, on whatever branch is checked out.
- **New worktree** — create a separate copy for the session, based on the **Base branch** you pick, so your main checkout stays untouched while the agent works. It's unavailable until the repository has at least one commit.
- **Existing worktrees** — run the session in a worktree that's already there, such as one an earlier session created. Search the list by worktree name or branch. This submenu appears only when the workspace has other worktrees.

The field shows **Local repository**, **New worktree**, or the name of the worktree you picked. In an open chat, the line under the message box shows **Local** or the worktree's name. Kilo Desktop remembers whether you chose **Local repository** or **New worktree** for each workspace and uses it for that workspace's new sessions, including after a restart. An existing worktree applies only to the session you're starting. Worktree sessions created in Kilo Desktop also appear in the [VS Code extension](/docs/code-with-ai/platforms/vscode)'s Agent Manager.

## Set up git for a folder

If the workspace folder isn't a git repository yet, select **Initialize Git** to create one. It's offered on the New Session page, under the chat's message box, and in the **Changes** tab. After that, the diff, branch, and worktree tools become available.

For a repository with no commits yet, **New worktree** is unavailable and the branch list explains why. For repositories Kilo Desktop can't use safely, such as bare or unsafe ones, the **Use** and **Branch** fields don't appear.
