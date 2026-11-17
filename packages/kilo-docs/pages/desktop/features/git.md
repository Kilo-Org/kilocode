---
title: "Git integration"
description: "Review your uncommitted changes, commit and open pull requests, pick a branch, and run sessions in a new or existing worktree in Kilo Desktop."
---

# Git integration

Review your changes and manage branches for the chat's workspace without leaving the conversation. Git integration uses your system `git`, so make sure Git 2.17 or newer is installed and on your `PATH`.

## Review changes

The **Changes** tab shows staged, unstaged, and untracked work against the last commit without staging it. Files are labeled with their paths, status icons (added, modified, deleted, or renamed), and added and removed counts. Expand or collapse files with diff lines to review them.

The diff refreshes automatically while the tab is visible, though changes outside watched workspace folders may be missed. Select **Refresh changes** to refresh it manually. In a multi-folder workspace, use the **Workspace folder** picker to choose a folder; you can also search the file tree. Ask the agent to open Changes or select a changed file for you, or press Ctrl+Shift+G to open it yourself.

When changes and statistics are available, the **git diff tracker** in the top toolbar shows the number of changed files and added (green) and removed (red) line counts. Select it to open **Changes**, or hover it to see *Approximate changes since the last commit.* Binary files don't contribute line counts, and counts for untracked files are capped.

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

The commit control in the top toolbar adapts to your branch's state, offering **Commit**, **Commit & push**, **Commit, push & PR**, **Push**, **Pull**, **Create PR**, or **View PR**. When the working tree is clean and local and upstream history have diverged, it shows a disabled **Sync branch** action: rebase or merge first. Open the dropdown to choose **Commit**, **Push**, or **Create PR** directly.

- **Commit** — stages all changes in the repository, generates a one-line commit message matching the repository's recent style, and commits the index. If message generation or the commit fails, changes can remain staged. Unavailable when the working tree is clean.
- **Push** — pushes the checked-out branch. It requires an `origin` remote and a branch that isn't behind its upstream. A branch without an upstream can be pushed to set one, even if it has no commits ahead.
- **Pull** — updates the branch with a fast-forward-only pull.
- **Create PR** — generates a title and description and creates a **draft** pull request targeting the detected default branch. It requires authenticated GitHub CLI (`gh`), a GitHub `origin` remote, a clean working tree, and a feature branch that isn't behind its upstream. Kilo pushes first if needed, asks the model to use a recognized PR template when available, and attempts to open the PR in your browser. When a pull request already exists, the menu links to it as **PR #N**, colored by its state.

Commit and PR text use the preferred model for new chats, or the server default if none is preferred. While an action runs, the button shows its progress (for example *Generating commit message...* or *Creating draft PR...*). If the button is disabled, hover it to see why (for example *Branch is behind its upstream. Pull or rebase first.*). Pushing or committing and pushing to the default branch asks for confirmation.

If a push fails, the error opens in a dialog where you can read the full git output. Select **Fix in chat** to add the error to your chat draft so the agent can help.

## Switch and create branches

On the [New Session page](/docs/desktop/quickstart#start-a-session), the **Branch** field lets you switch branches for the folder the session will work in. The list is grouped into **Default Branch**, **Recent Branches**, and **Other Branches**, and you can search it. Selecting a branch checks it out; choosing a remote branch creates a local tracking branch for it. The checkout changes immediately, before the session starts. In an open chat, the current branch is shown under the message box.

If the branch you pick is already checked out in another worktree, Kilo Desktop sets **Use** to that worktree instead of checking the branch out again; if it's checked out in your main repository, **Use** switches to **Local repository**.

When the session uses an existing worktree that other sessions also use, Kilo Desktop asks **Switch branch in this worktree?** before changing its branch, because the change affects those sessions too. Select **Switch anyway** to continue, or **Cancel**.

To start new work, select **Create branch** in the branch list. When your current branch differs from the repository's default branch, choose which one to base it on under **Create branch based on…**. The new branch is checked out as soon as it's created.

## Work locally or in a worktree

On the New Session page, next to **Workspace**, the **Use** field sets where a new session's changes go:

- **Local repository** — work in the repository already on your machine, on whatever branch is checked out.
- **New worktree** — create a separate copy for the session, based on the **Base branch** you pick, so your main checkout stays untouched while the agent works. It's unavailable until the repository has at least one commit.
- **Existing worktrees** — run the session in an eligible worktree that's already there, such as one an earlier session created. Search by worktree name or branch. This submenu appears when eligible worktrees are available; detached, stale, and worktrees outside the workspace folders aren't listed.

The field shows **Local repository**, **New worktree**, or the name of the worktree you picked. In an open chat, the line under the message box shows **Local** or the worktree's name. Kilo Desktop remembers whether you chose **Local repository** or **New worktree** for each workspace and uses it for that workspace's new sessions, including after a restart. An existing worktree applies only to the session you're starting. Desktop-managed worktrees share storage with the [VS Code extension](/docs/code-with-ai/platforms/vscode)'s Agent Manager, though linking the conversation is best-effort.

When you delete the last session using a worktree, choose **Keep worktree** or **Delete both**. Deleting the worktree can lose uncommitted changes and unpushed commits. A session can also show its pull request; use the PR filter in the session list to find it.

## Set up git for a folder

If the workspace folder isn't a git repository yet, select **Initialize Git** to create one. It's offered on the New Session page, under the chat's message box, and in the **Changes** tab. You can then review changes and commit them; branch switching and new worktrees require an initial commit.

For a repository with no commits yet, **New worktree** is unavailable and the branch list explains why. For repositories Kilo Desktop can't use safely, such as bare or unsafe ones, the **Use** and **Branch** fields don't appear.
