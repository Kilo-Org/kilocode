---
title: "Troubleshooting IDE Extensions"
description: "How to capture console logs and report issues with Kilo Code"
---

# Capturing Console Logs

Providing console logs helps us pinpoint exactly what's going wrong with your installation, network, or MCP setup. This guide walks you through capturing those logs in your IDE.

## Opening Developer Tools

{% tabs %}
{% tab label="VS Code" %}

1. **Open the Command Palette**: Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. **Search for Developer Tools**: Type `Developer: Open Webview Developer Tools` and select it

{% /tab %}
{% tab label="JetBrains" %}

### Enable JCEF Debugging

1. Open your JetBrains IDE and go to **Help → Find Action** (or press `Cmd+Shift+A` / `Ctrl+Shift+A`)
2. Type `Registry` and open it
3. Search for `jcef` and configure these settings:
    - `ide.browser.jcef.debug.port` → set to `9222`
    - `ide.browser.jcef.contextMenu.devTools.enabled` → check the box
4. Restart your IDE after making these changes

### Connect Chrome DevTools

1. Make sure the **Kilo Code panel is open** in your IDE (the debug target won't appear unless the webview is active)
2. Open Chrome (or any Chromium-based browser like Edge or Arc)
3. Navigate to `http://localhost:9222/json` to see the list of inspectable targets
4. Find the entry with `"title": "Kilo Code"` and open the `devtoolsFrontendUrl` link
5. Chrome DevTools will open connected to the Kilo webview—click the **Console** tab

{% /tab %}
{% /tabs %}

## Capturing the Error

Once you have the Developer Tools console open:

1. **Clear previous logs**: Click the "Clear Console" button (🚫 icon at the top of the Console panel) to remove old messages
2. **Reproduce the issue**: Perform the action that was causing problems
3. **Check for errors**: Look at the Console tab for error messages (usually shown in red). If you suspect connection issues, also check the **Network** tab
4. **Copy the logs**: Right-click in the console and select "Save as..." or copy the relevant error messages

## Contact Support

If you're unable to resolve the issue, please inspect the console logs, remove any secrets, and send the logs to **[hi@kilocode.ai](mailto:hi@kilocode.ai)** along with the following:

- The error messages from the console
- Steps to reproduce the issue
- Screenshots or screen recordings of the issue
- Your IDE and Kilo Code version
