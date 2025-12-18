# JetBrains Plugin Troubleshooting

This guide covers common issues when using Kilo Code in JetBrains IDEs (IntelliJ IDEA, Android Studio, WebStorm, PyCharm, etc.).

## Known Missing Features

The following features, available in the VS Code version of Kilo Code, are not currently implemented in the JetBrains version:

- **Autocomplete/QuickTasks**
- **Git Commit Message Generation** This feature is missing but will be added soon!

We're actively working on bringing feature parity between the VS Code and JetBrains versions. Check our [GitHub repository](https://github.com/Kilo-Org/kilocode) for updates on development progress.

## Node.js Requirements

### Why Node.js is Required

The JetBrains Kilo Extension requires Node.js to be installed on your system. Node.js is used to run the extension's backend services and handle communication between the IDE and Kilo Code's AI features.

### Installing Node.js

Visit the official Node.js website for installation instructions for your platform: [https://nodejs.org/en/download](https://nodejs.org/en/download)

We recommend downloading the **LTS (Long Term Support)** version for stability.

### Verifying Node.js Installation

After installation, verify that Node.js is properly installed by opening a terminal and running:

```bash
node --version
npm --version
```

Both commands should return version numbers.

## JCEF (Java Chromium Embedded Framework) Issues

### What is JCEF?

JCEF (Java Chromium Embedded Framework) is required for Kilo Code's web-based interface to display properly in JetBrains IDEs. Most JetBrains IDEs include JCEF support by default, but some configurations may need manual activation.

## Fixing JCEF Issues by IDE

### Android Studio

JCEF is available in Android Studio but may need to be enabled manually:

1. **Open Settings/Preferences:**

    - **Windows/Linux:** File → Settings
    - **macOS:** Help → Find Action...

2. **Navigate to Boot Java Runtime:**

    - Choose Boot Java Runtime for the IDE...

3. **Pick a new runtime**

    - Pick one that has "with JCEF" in the name

4. **Restart Android Studio:**

    - Close and reopen Android Studio for the changes to take effect

5. **Verify:**
    - Open Kilo Code panel
    - The JCEF warning should be gone, and the interface should load properly

**Visual Guide:**

<img src="/docs/img/jetbrains/android-studio-jcef-enable.gif" alt="Step-by-step guide showing how to enable JCEF in Android Studio" width="600" />

_This animation shows the complete process of enabling JCEF in Android Studio._

### IntelliJ IDEA

JCEF should be enabled by default in IntelliJ IDEA. If you see JCEF warnings:

1. **Update IntelliJ IDEA:**

    - Ensure you're running the latest version
    - Go to Help → Check for Updates

2. **Verify JetBrains Runtime:**

    - IntelliJ IDEA should use JetBrains Runtime (JBR) by default
    - JBR includes JCEF support

3. **Check Advanced Settings:**
    - Go to File → Settings (Windows/Linux) or IntelliJ IDEA → Preferences (macOS)
    - Navigate to Advanced Settings
    - Look for any JCEF-related options and ensure they're enabled

### Other JetBrains IDEs

For WebStorm, PyCharm, PhpStorm, RubyMine, CLion, GoLand, DataGrip, and Rider:

1. **Update to Latest Version:**

    - Most JCEF issues are resolved in recent versions
    - Use the built-in updater: Help → Check for Updates

2. **Verify JetBrains Runtime:**

    - These IDEs should use JetBrains Runtime by default
    - JBR includes comprehensive JCEF support

3. **Check Settings:**
    - Go to File → Settings (Windows/Linux) or [IDE Name] → Preferences (macOS)
    - Navigate to Advanced Settings
    - Enable any JCEF-related options

## Authentication Issues

### Incomplete Kilo Code authentication

**Important:** The Kilo Code authentication callback requires [JetBrains Toolbox](https://www.jetbrains.com/toolbox-app/) to be installed on your system.

#### Why Toolbox is Required

When you authenticate with Kilo Code, the browser redirects back to your IDE using a special URL scheme (`jetbrains://`). This URL scheme is **only registered on your system when JetBrains Toolbox is installed**. Without Toolbox:

- The authentication redirect will fail silently
- Your browser may show an error like "Cannot open link" or "No application is set to open this link"
- The token will not be passed back to your IDE

#### Symptoms of Missing Toolbox

If you're experiencing authentication issues, you may notice:

1. **Browser doesn't redirect after login** - After entering your credentials, the browser stays on the authentication page or shows an error
2. **"Open in IDE" prompts don't work** - Links that should open in your JetBrains IDE do nothing
3. **No logs in the IDE** - The authentication handler never fires because the URL scheme isn't registered

#### Installing JetBrains Toolbox

1. **Download JetBrains Toolbox:**

    - Visit [https://www.jetbrains.com/toolbox-app/](https://www.jetbrains.com/toolbox-app/)
    - Download the installer for your operating system

2. **Install and Launch:**

    - Run the installer
    - Launch JetBrains Toolbox

3. **Retry Authentication:**
    - Return to Kilo Code in your JetBrains IDE
    - Attempt the authentication flow again
    - The `jetbrains://` URL should now work correctly

#### Alternative: Manual Token Entry

If you cannot install JetBrains Toolbox, you can manually configure your API provider:

1. Go to Kilo Code Settings
2. Select your API provider
3. Manually enter your API key or authentication token
4. Save your settings

_For general Kilo Code support and documentation, visit [kilo.ai/docs](https://kilo.ai/docs)_
