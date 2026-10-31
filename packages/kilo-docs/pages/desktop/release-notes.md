---
title: "Release notes"
description: "New features, improvements, bug fixes, and security updates in each Kilo Desktop release."
---

# Release notes

Kilo Desktop updates itself automatically. To check which version you're running or to install an update, open the **About** section of the [General settings](/docs/desktop/settings/general#about).

## Kilo Desktop 0.1.15

Released October 30, 2026

**What's new**

- Mermaid diagrams now render in the Files viewer and in chat.
- Kilo Desktop now warns you when a workspace folder is no longer available, for example after it was moved or deleted, or when it's on a disconnected drive.

**Improvements and bug fixes**

- Pop-out pane windows no longer open in macOS full screen.
- Deleting a workspace no longer leaves the session list focused on a workspace that doesn't exist.

**Security**

This release completes the fix for [CVE-2026-111497](https://nvd.nist.gov/vuln/detail/CVE-2026-111497), an out-of-bounds write vulnerability in the Google Brotli decoder.

- Updated Electron to version 45.1.0, which includes Node 24.22.1 with the Brotli fix.
- Updated the bundled conda tools to use Brotli 1.2.1.

If you have conda environments that include `brotli`, update it to version 1.2.1, 1.1.1, or 1.0.10.

## Kilo Desktop 0.1.14

Released October 23, 2026

**What's new**

- The agent can now show HTML pages, such as charts, tables, and diagrams, inline in chat. You can save a page to your workspace as an `.html` file, and HTML files you open from Files now open rendered in a Browser tab.
- You can now start a session in an existing worktree, and picking a branch that's checked out in another worktree switches to it.
- The terminal now supports Ghostty keybindings, shows selections clearly, and supports copying text.
- Clicking a file link in chat now opens the matching file in your workspace.

**Improvements and bug fixes**

- Kilo Desktop now requires Git 2.17 or later, and tells you when your installed Git is too old.
- The worktree delete dialog now shows the session and worktree that will be removed.
- The agent now asks for your approval each time it adds or removes a conda channel.
- Fixed the diff file tree breaking when a change contains a file and a folder at the same path.
- Fixed the conversation map not spanning the full height of the window with some scrollbar settings.

**Security**

This release addresses the [compromised eMudhra intermediate CA certificates](https://emudhra.we-have-a-problem.com/). Kilo Desktop's bundled components no longer trust the leaked certificates.

- Updated Electron to version 44.9.3, which rejects the compromised certificate chains.
- Updated the bundled conda tools with `certifi` 2026.10.19.
- Updated the bundled Kilo CLI to version 7.8.17, which runs on Bun 1.4.4. Bun 1.4.4 rejects the compromised certificates and also fixes [CVE-2026-111497](https://nvd.nist.gov/vuln/detail/CVE-2026-111497) for the agent's network requests.
- Updated third-party dependencies to include upstream security fixes.

Your operating system's certificate store might still trust the compromised certificates. To fix this, follow the steps for macOS, Windows, or Linux on the [incident site](https://emudhra.we-have-a-problem.com/#workarounds).

Conda environments created before this release might contain outdated `certifi` or `ca-certificates` packages. Update `certifi` to version 2026.10.19 or later and `ca-certificates` to version 2026.10.20 or later.

## Kilo Desktop 0.1.13

Released October 21, 2026

**What's new**

- CSV, TSV, and Parquet files open as interactive tables in the Files viewer.
- Added app-wide keyboard shortcuts for switching tabs and sessions.
- You can now filter the session list by pull request, or show only chats that don't belong to a workspace.
- The **About** section of the General settings now has a **Support** section that shows the locations of the application log and the global Kilo configuration.
- Kilo Desktop comes to the front when you approve Kilo sign-in in your browser.
- You can now edit, reorder, and pause queued messages.
- Press ⌘F (macOS) or Ctrl+F (Windows/Linux) to find text in the chat, a plan, or a rendered Markdown preview.

**Improvements and bug fixes**

- Kilo Desktop now asks for confirmation before deleting a chat. **Archive** and **Delete** are now grouped together.
- "New Chat" is now "New Session".
- The notebook side panel now opens with its drawer collapsed.
- Reduced the size of the installed app.
- Session titles from Kilo now appear in the session list instead of being cleared after the first reply.
- The plan tab now switches to the refined plan as soon as it's ready.
- On macOS, Git is now correctly reported as missing when the Command Line Tools aren't installed.

## Kilo Desktop 0.1.12

Released October 15, 2026

**What's new**

- Kilo Desktop can play a sound when a chat finishes or needs you (an approval, a question, or an error), and shows a system notification while it's in the background. Choose when in the **Notifications** settings.
- Before you install an MCP from the Marketplace, Kilo Desktop shows the exact command or endpoint it will add, with secrets masked. If the configuration changes after you review it, the install is refused.
- Shift+click a session in the session list to pin or unpin it.
- The **About** section of the General settings has an **Application logs** card that shows the log file in Finder, File Explorer, or your file manager.
- Notebooks now require a Kilo account. While you're signed out, the **Notebook** option is grayed out, notebook tabs show a sign-in prompt, and the chat asks you to sign in when the agent tries to use notebooks.
- A refreshed look: areas are separated by tone instead of borders, and Kilo yellow is the same in light and dark themes.

**Improvements and bug fixes**

- You now need to accept the terms of service before you can use Kilo Desktop.
- If the first message in a new chat fails to send, you can send it again, and Kilo Desktop tells you why the chat couldn't start.
- Fixed parts of the chat, input, and sidebar disappearing in long conversations.
- **Commit, push & PR** now pushes and opens the pull request from the branch that's checked out when you run it.
- The Changes tab remembers whether you hid the file tree.
- Selecting the file that's already selected in Files now reopens its tab if you closed it.
- On Windows, the Files tree no longer fails when a folder is locked or deleted while it's being read.
- The local model server now installs when your conda configuration uses a custom channel alias, and uses llama.cpp 0.6.0 on all platforms.
- When you're signed out, the agent asks you to sign in before it uses conda tools, and it prefers Anaconda's channels when it creates or updates conda environments. The **Create environment** dialog checks the name and location as you type.

**Security**

- Updated Electron to version 44.7.0 and third-party dependencies to include upstream security fixes.

## Kilo Desktop 0.1.11

Released October 6, 2026

**What's new**

- Right-click a link anywhere in Kilo Desktop, including pages in a Browser tab, and choose **Open Link in Default Browser**. Browser tabs also have an **Open in Default Browser** menu item.
- When an MCP from the Marketplace needs a program that isn't installed (such as `npx` or `uvx`), Kilo Desktop warns you, shows install commands for your OS, and offers **Fix in chat** to have the agent help.

**Improvements and bug fixes**

- When the session list is grouped by workspace, every workspace is now listed, and empty ones show **No chats yet**.
- On a narrow sidebar, a session's time now gives way to its pull request so the title stays readable.
- The warning about installing local package files no longer appears for commands that only reference a conda environment folder, and now also appears when pip installs a local wheel or archive.
- Fixed Browser tabs showing a blank page after being popped out into their own window.
- On macOS, when Git is blocked because the Xcode license hasn't been accepted, Kilo Desktop now tells you how to fix it.
- Fixed the local model list failing to load when it included models added by an earlier version.
- The conda environments page shows clearer messages while the conda backend starts or fails to load, and **Install** stays disabled until the solver finds a working set of packages.

## Kilo Desktop 0.1.10

Released October 1, 2026

First public release of Kilo Desktop. See the [Overview](/docs/desktop/overview) and [Features](/docs/desktop/features) to get started.
