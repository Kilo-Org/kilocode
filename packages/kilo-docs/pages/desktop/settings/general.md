---
title: "General settings"
description: "Manage your account, appearance, conda environments, notebooks, and privacy in Kilo Desktop."
---

# General settings

Open settings from the gear at the bottom of the sidebar, and use the search box at the top to filter them. The **General** settings cover the app version, your account, appearance, conda environments, notebooks, and privacy.

## About

The **About** section shows the app's version and manages updates:

- **Version** — the build you're running, with its update status. When a newer build has downloaded it reads *Version X is ready to install*; otherwise use **Check for updates** to look for one.
- **Update track** — choose whether to get **Stable** releases or **Preview** builds.

When an update is ready, select **Restart to update** to relaunch and apply it.

## Account

The **Account** section manages your **Kilo** account. When you're signed in, it shows your account email, your **Available balance** (with a refresh), an **Organization** selector, and **Top up** and **Kilo Dashboard** links. See [Usage & Billing](/docs/gateway/usage-and-billing) for how organizations and balances work.

## Appearance

The **Appearance** section controls how the app looks:

- **Theme** — switch between **Light**, **Dark**, or **System**.
- **Color theme** — choose the app's color theme from the dropdown, such as **Kilo**.
- **Accent color** — use the theme's accent (the **Theme** option) or pick your own from the color swatches.
- **Sidebar vibrancy** — toggle a translucent sidebar background on or off.
- **Interface text size** — adjust the text size in the sidebar, menus, and settings.
- **Chat text size** — adjust the text size of chat messages, the input, and tool output.

## Conda Environments

Create and manage conda environments and their packages. See [Environments](/docs/desktop/features/environments) for what you can do here. Requires a Kilo account.

## Notebooks

The **Notebooks** section has two settings:

- **Automatically create environment.yml** — give new notebooks a shared conda environment in their workspace.
- **Trust new notebooks** — skip the dependency approval prompt for new notebooks.

See [Notebooks](/docs/desktop/features/notebooks) for working with notebooks in a chat.

## Privacy

The **Privacy** section has a single **Share usage analytics and crash reports** toggle. When on, it shares usage analytics and crash reports with Kilo — including from the embedded Kilo service and conda environment manager. 

It also explains data handling for **free models**: because they may route your requests to providers that log prompts and outputs, don't submit personal or confidential data when using them. See [Using Kilo for Free](/docs/getting-started/using-kilo-for-free) for details, and use the chat model picker's filter to exclude free models.
