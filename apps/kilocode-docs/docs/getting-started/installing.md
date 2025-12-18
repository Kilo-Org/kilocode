---
sidebar_label: Installing Kilo Code
---

# Installing Kilo Code

Kilo Code brings AI-powered coding assistance directly to your editor. Install using one of these methods:

- [**VS Code Marketplace (Recommended)**](#vs-code-marketplace) - fastest method for standard VS Code users
- [**Cursor Marketplace**](#cursor-marketplace) - recommended way for Cursor users
- [**Open VSX Registry**](#open-vsx-registry) - for VS Code-compatible editors like VSCodium or Windsurf
- [**Manually install the .vsix file**](#manual-installation-from-vsix) - direct installation from the GitHub Release
- [**JetBrains IDEs**](#jetbrains-ides) - for IntelliJ IDEA, WebStorm, PyCharm, Android Studio, and other JetBrains IDEs

## VS Code Marketplace

:::tip

If you already have VS Code installed: [Click here to install Kilo Code](vscode:extension/kilocode.Kilo-Code)

:::

alternatively, you can:

1. Open VS Code
2. Access Extensions: Click the Extensions icon in the Side Bar or press `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (macOS)
3. Search for "Kilo Code"
4. Select "Kilo Code" by Kilo Code and click **Install**
5. Reload VS Code if prompted

After installation, find the Kilo Code icon (<img src="/docs/img/kilo-v1.svg" width="12" />) in the Side Bar to open the Kilo Code panel.

<img src="/docs/img/installing/installing.png" alt="VS Code marketplace with Kilo Code extension ready to install" width="400" />
*VS Code marketplace with Kilo Code extension ready to install*

## Cursor Marketplace

:::tip

If you already have Cursor installed: [Click here to install Kilo Code](cursor:extension/kilocode.Kilo-Code)

:::

alternatively, you can:

1. Open Cursor
2. Access Extensions: Click the Extensions icon in the Side Bar or press `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (macOS)
3. Search for "Kilo Code"
4. Select "Kilo Code" by Kilo Code and click **Install**
5. Reload Cursor if prompted

After installation, find the Kilo Code icon (<img src="/docs/img/kilo-v1.svg" width="12" />) in the Side Bar to open the Kilo Code panel.

## Open VSX Registry

[Open VSX Registry](https://open-vsx.org/) is an open-source alternative to the VS Code Marketplace for VS Code-compatible editors that cannot access the official marketplace due to licensing restrictions.

For VS Code-compatible editors like VSCodium, Gitpod, Eclipse Theia, and Windsurf, you can browse and install directly from the [Kilo Code page on Open VSX Registry](https://open-vsx.org/extension/kilocode/Kilo-Code).

1. Open your editor
2. Access the Extensions view (Side Bar icon or `Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Your editor should be pre-configured to use Open VSX Registry
4. Search for "Kilo Code"
5. Select "Kilo Code" and click **Install**
6. Reload the editor if prompted

:::note
If your editor isn't automatically configured for Open VSX Registry, you may need to set it as your extension marketplace in settings. Consult your specific editor's documentation for instructions.
:::

## Manual Installation from VSIX

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

<img src="/docs/img/installing/installing-2.png" alt="VS Code's Install from VSIX dialog" width="400" />
*Installing Kilo Code using VS Code's "Install from VSIX" dialog*

## JetBrains IDEs

Kilo Code is also available as a plugin for JetBrains IDEs including IntelliJ IDEA, WebStorm, PyCharm, Android Studio, PhpStorm, RubyMine, CLion, GoLand, DataGrip, and Rider.

### Prerequisites

Before installing the Kilo Code plugin, ensure you have:

1. **JetBrains Toolbox (Recommended):**

    - Download from [https://www.jetbrains.com/toolbox-app/](https://www.jetbrains.com/toolbox-app/)
    - Toolbox is required for authentication callbacks to work properly
    - Without Toolbox, you'll need to manually configure API keys

2. **Node.js:**
    - Download LTS version from [https://nodejs.org/](https://nodejs.org/)
    - Required for the extension's backend services

### Installation Steps

1. **Open your JetBrains IDE**

2. **Access Plugin Settings:**

    - **Windows/Linux:** File → Settings → Plugins
    - **macOS:** [IDE Name] → Settings → Plugins

3. **Search for Kilo Code:**

    - Click the "Marketplace" tab
    - Search for "Kilo Code"

4. **Install the Plugin:**

    - Click **Install** on the Kilo Code plugin
    - Accept any required permissions

5. **Restart your IDE:**

    - Restart when prompted to complete the installation, if needed

6. **Find Kilo Code:**
    - Look for the Kilo Code icon in the right sidebar
    - Click to open the Kilo Code panel

### Troubleshooting JetBrains Installation

For JetBrains-specific issues such as JCEF problems, authentication failures, or Node.js configuration, see the [JetBrains Troubleshooting Guide](/docs/jetbrains-troubleshooting).

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

## Getting Support

If you encounter issues not covered here:

- Join our [Discord community](https://kilo.ai/discord) for real-time support
- Submit issues on [GitHub](https://github.com/Kilo-Org/kilocode/issues)
- Visit our [Reddit community](https://www.reddit.com/r/KiloCode)
