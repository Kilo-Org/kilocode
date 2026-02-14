---
title: "Installation"
description: "How to install Kilo Code on your system"
---

# Installation

Get started with Kilo Code by installing it on your preferred platform. Choose your development environment below:

## Choose Your Platform

{% tabs %}
{% tab label="VS Code" %}

## VS Code Extension

{% partial file="install-vscode.md" /%}

{% /tab %}
{% tab label="JetBrains" %}

## JetBrains IDEs

{% partial file="install-jetbrains.md" /%}

{% /tab %}
{% tab label="CLI" %}

## Command Line Interface

{% partial file="install-cli.md" /%}

{% /tab %}
{% tab label="Slack" %}

## Slack Integration

{% partial file="install-slack.md" /%}

{% /tab %}
{% tab label="Other IDEs" %}

{% partial file="install-other-ides.md" /%}

{% /tab %}
{% /tabs %}

## Pre-Release Extension

{% callout type="info" %}
We're rebuilding Kilo Code from the ground up on the new [Kilo CLI](https://github.com/Kilo-Org/kilo). The pre-release extension is available for users who want to try the latest architecture and provide feedback, and don't mind some missing features and rough edges.
{% /callout %}

The pre-release extension is a complete rebuild featuring:

- A new Solid.js-based UI
- Deep integration with the Kilo CLI backend
- Improved session management and model switching

### Current Status

This is an early pre-release. Core features like chat, markdown rendering, authentication, and model/mode switching are working. Some features from the stable extension are still being implemented.

For the full feature status, see the [feature parity tracking document](https://github.com/Kilo-Org/kilo/blob/main/packages/kilo-vscode/docs/opencode-migration-plan.md).

### Installing the Pre-Release

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Kilo Code"
4. Click the dropdown arrow next to **Install** and select **Install Pre-Release Version**

### Switching Back to Stable

If you need to return to the stable version:

1. Open Extensions in VS Code
2. Find Kilo Code
3. Click the dropdown and select **Switch to Release Version**

### Feedback and Issues

Report issues or provide feedback in the [Kilo-Org/kilo repository](https://github.com/Kilo-Org/kilo/issues).

## Manual Installations

### Open VSX Registry

[Open VSX Registry](https://open-vsx.org/) is an open-source alternative to the VS Code Marketplace for VS Code-compatible editors that cannot access the official marketplace due to licensing restrictions.

For VS Code-compatible editors like VSCodium, Gitpod, Eclipse Theia, and Windsurf, you can browse and install directly from the [Kilo Code page on Open VSX Registry](https://open-vsx.org/extension/kilocode/Kilo-Code).

1. Open your editor
2. Access the Extensions view (Side Bar icon or `Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Your editor should be pre-configured to use Open VSX Registry
4. Search for "Kilo Code"
5. Select "Kilo Code" and click **Install**
6. Reload the editor if prompted

{% callout type="note" %}
If your editor isn't automatically configured for Open VSX Registry, you may need to set it as your extension marketplace in settings. Consult your specific editor's documentation for instructions.
{% /callout %}

### Via VSIX

If you prefer to download and install the VSIX file directly:

1. **Download the VSIX file:**

    - Find official releases on the [Kilo Code GitHub Releases page](https://github.com/Kilo-Org/kilocode/releases)
    - Download the `.vsix` file from the [latest release](https://github.com/Kilo-Org/kilocode/releases/latest)

2. **Install in VS Code:**
    - Open VS Code
    - Access Extensions view
    - Click the "..." menu in the Extensions view
    - Select "Install from VSIX..."
    - Browse to and select your downloaded `.vsix` file

{% image src="/docs/img/installing-vsix.png" alt="Installing Kilo Code using VS Code's Install from VSIX dialog" width="600px" caption="Installing Kilo Code using VS Code's \"Install from VSIX\" dialog" /%}

## Troubleshooting

**Extension Not Visible**

- Restart VS Code
- Verify Kilo Code is listed and enabled in Extensions
- Try disabling and re-enabling the extension in Extensions
- Check Output panel for errors (View → Output, select "Kilo Code")

**Installation Problems**

- Ensure stable internet connection
- Verify VS Code version 1.84.0 or later
- If VS Code Marketplace is inaccessible, try the Open VSX Registry method

**Windows Users**

- Ensure that **`PowerShell` is added to your `PATH`**:
    1. Open **Edit system environment variables** → **Environment Variables**
    2. Under **System variables**, select **Path** → **Edit** → **New**
    3. Add: `C:\Windows\System32\WindowsPowerShell\v1.0\`
    4. Click **OK** and restart VS Code

## Next Steps

After installation, check out these resources to get started:

- [Quickstart Guide](/docs/getting-started/quickstart) - Get up and running in minutes
- [Setting Up Authentication](/docs/getting-started/setup-authentication) - Configure your AI provider
- [Your First Task](/docs/code-with-ai/agents/chat-interface) - Learn the basics of working with Kilo Code

## Getting Support

If you encounter issues not covered here:

- Join our [Discord community](https://kilo.ai/discord) for real-time support
- Submit issues on [GitHub](https://github.com/Kilo-Org/kilocode/issues)
- Visit our [Reddit community](https://www.reddit.com/r/KiloCode)
