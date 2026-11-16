---
title: "General settings"
description: "Manage the app version, your accounts, appearance, notifications, conda environments, notebooks, privacy, and keyboard shortcuts in Kilo Desktop."
---

# General settings

Open settings from the gear at the bottom of the sidebar, and use the search box at the top to filter them. The **General** settings cover the app version and logs, your accounts, appearance, notifications, conda environments, notebooks, privacy, and keyboard shortcuts.

## About

The **About** section shows the app's version and manages updates:

- **Version** — the build you're running and its update status. On macOS and Windows, when a newer build has downloaded, it reads *Version X is ready to install*. On Linux, when one is available, it reads *Version X is available to download* and shows a **Download** button that opens the new `.deb` package in your browser. Otherwise use **Check for updates** to look for one.
- **Support** — information to include when you contact support:
  - **Application logs** — shows the path to the app's log file. Select **Show in Finder** (macOS), **Show in File Explorer** (Windows), or **Show in File Manager** (Linux) to find it.
  - **Kilo config** — shows the path to your global Kilo config file (for example `~/.config/kilo/kilo.json`), with the same button. If you haven't created one, it reads *No global config file has been created yet.*
- **Legal** — select **View** next to **Third-party notices** to read the licenses of the third-party software Kilo Desktop includes. Next to **Chromium**, select **Show in Finder** (macOS), **Show in File Explorer** (Windows), or **Show in File Manager** (Linux) to find Chromium's notices.

When an update is ready, select **Restart to update**, then **Install and restart**, to relaunch and apply it. The sidebar also shows **Restart to update** (on Linux, **Update available**, which opens **About**). When release notes are available, the **About** section also shows a **What's changed** section for the update; notes from earlier versions are labeled with their version. See [Updates](/docs/desktop/installation#updates).

## Account

The **Account** section manages the accounts Kilo Desktop signs in to.

**Kilo** — when you're signed in, it shows your account email, your **Available balance** (with a refresh), an **Organization** selector if you belong to an organization, and **Top up** and **Kilo Dashboard** links. Personal accounts also see Kilo Pass usage or a **Get Kilo Pass** link. See [Usage & Billing](/docs/gateway/usage-and-billing) for how organizations and balances work.

**Anaconda** — sign in to browse and download models from the [Anaconda model catalog](/docs/desktop/settings/ai#model-catalog), and to install packages from authenticated channels like main-x. The row reads **Not signed in.** or **Signed in as** followed by your email. Select **Sign in** and complete the sign-in in your browser; the button reads **Waiting for browser…** until you do, and **Cancel** stops the sign-in. Select **Sign out** to sign out.

Your Anaconda account is separate from your Kilo account. Kilo Desktop stores your Anaconda credentials where conda and the Anaconda CLI read them, so signing in with `anaconda login` also signs you in here, and signing out here also signs out those tools.

## Appearance

The **Appearance** section controls how the app looks:

- **Theme** — switch between **Light**, **Dark**, or **System**. Kilo Desktop starts in **Dark** until you choose a theme.
- **Color theme** — choose the app's color theme from the dropdown, such as **Kilo**.
- **Accent color** — use the theme's accent (the **Theme** option) or pick your own from the color swatches.
- **Sidebar vibrancy** — toggle a translucent sidebar background on or off.
- **Interface text size** — adjust the text size in the sidebar, menus, and settings.
- **Chat text size** — adjust the text size of chat messages, the input, and tool output.

## Notifications

The **Notifications** section controls when Kilo plays a sound to get your attention. While Kilo is in the background, it also shows a system notification. Set each of these:

- **When Kilo finishes** — Kilo completed its turn, including any background subagents.
- **When Kilo needs you** — an approval, a question, or an error. Requests answered by **Automatically approve** don't play a sound.

For each, choose **Never**, **When I'm not looking** (skips the session you have open), or **Always**. Select the speaker button to preview the sound. To silence the system notifications entirely, use your operating system's notification settings.

## Conda Environments

Create and manage conda environments and their packages. See [Conda environments](/docs/desktop/features/environments) for what you can do here. Requires a Kilo account.

## Notebooks

The **Notebooks** section has two settings:

- **Automatically create environment.yml** — give new notebooks a shared conda environment in their workspace.
- **Trust new notebooks** — skip the dependency approval prompt for new notebooks.

See [Notebooks](/docs/desktop/features/notebooks) for working with notebooks in a chat. Requires a Kilo account; if you're signed out, the section shows a **Sign in to Kilo** prompt, the same as Conda Environments.

## Privacy

The **Privacy** section has a single **Share usage analytics and crash reports** toggle. When on, it shares usage analytics and crash reports with Kilo — including from the embedded Kilo service and conda environment manager. 

It also explains data handling for **free models**: because they may route your requests to providers that log prompts and outputs, don't submit personal or confidential data when using them. See [Using Kilo for Free](/docs/getting-started/using-kilo-for-free) for details, and use the chat model picker's filter to exclude free models.

## Shortcuts

The **Shortcuts** section lets you see, change, or turn off the app's keyboard shortcuts.

- **Tabs** and **Sessions** include numbered shortcuts: **Go to tab 1**–**8** (⌘1–8 on macOS, Ctrl+1–8 on Windows/Linux) and **Go to last tab** (⌘9 / Ctrl+9); **Go to session 1**–**8** (⌃1–8 on macOS, Alt+1–8 on Windows/Linux) and **Go to last session** (⌃9 / Alt+9). Change or turn off each one like any other shortcut.
- **All shortcuts** — select a shortcut and press the new keys to change it (Esc cancels). Hover a shortcut and select × to turn it off. A new shortcut must include ⌘, ⌃, or ⌥ (Ctrl or Alt on Windows/Linux). Kilo tells you if a shortcut is reserved by the system or already used by another action. Select ↺ next to a changed shortcut to restore its default. Shortcuts you can't change, like Enter to send, are in the **full list**.
- **Reset all** restores every default.

Press ⌘/ (macOS) or Ctrl+/ (Windows/Linux) anywhere to open the searchable **Keyboard shortcuts** reference.
