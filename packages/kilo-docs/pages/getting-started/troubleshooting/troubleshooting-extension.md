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

## SQLite database is malformed

If every prompt fails with `SQLiteError: database disk image is malformed`, Kilo Code's local SQLite database may be corrupted. This database stores local Kilo state such as sessions and history.

### Find the database

The database location depends on where Kilo Code is running:

| Environment | Database path |
|---|---|
| Windows | `%LOCALAPPDATA%\kilo\kilo.db` |
| macOS | `~/Library/Application Support/kilo/kilo.db` |
| Linux | `~/.local/share/kilo/kilo.db` |
| VS Code Remote SSH | `~/.local/share/kilo/kilo.db` on the remote machine |

{% callout type="warning" %}
When using VS Code Remote SSH, check the remote Linux machine, not your local Windows or macOS computer.
{% /callout %}

### Reset the database

Close VS Code or stop the Kilo backend first. On Linux or Remote SSH, run:

```bash
pkill -f "kilo serve"
mkdir -p ~/.local/share/kilo
mv ~/.local/share/kilo/kilo.db ~/.local/share/kilo/kilo.db.bak
mv ~/.local/share/kilo/kilo.db-wal ~/.local/share/kilo/kilo.db-wal.bak 2>/dev/null
mv ~/.local/share/kilo/kilo.db-shm ~/.local/share/kilo/kilo.db-shm.bak 2>/dev/null
```

Then reload VS Code or reconnect Remote SSH. Kilo Code recreates the database the next time it starts.

On Windows or macOS, rename the database file and any `kilo.db-wal` or `kilo.db-shm` files in the same folder, then restart the IDE.

{% callout type="warning" %}
Renaming this database resets local Kilo Code sessions and history for that machine. Keep the `.bak` files if you need to share them with support or attempt recovery later.
{% /callout %}

### Fully reset local Kilo data

If resetting the database does not fix the issue, you can fully reset Kilo Code's local data. This also removes local configuration and cache files, so use it only after trying the database reset above.

On Linux or VS Code Remote SSH, run this on the machine where Kilo Code is running:

```bash
pkill -f "kilo serve"
mv ~/.local/share/kilo ~/.local/share/kilo.bak 2>/dev/null
mv ~/.config/kilo ~/.config/kilo.bak 2>/dev/null
mv ~/.cache/kilo ~/.cache/kilo.bak 2>/dev/null
```

Then reload VS Code or reconnect Remote SSH. Kilo Code recreates these directories the next time it starts.

{% callout type="warning" %}
This resets local sessions, history, settings, and cached data. Prefer renaming the directories instead of deleting them so you can recover files. Remove secrets such as API keys or tokens before sharing any backup with support.
{% /callout %}

## Proxy and Certificate Troubleshooting

Kilo Code for VS Code starts its embedded runtime from the extension and applies the relevant VS Code network settings to that runtime. On managed networks, configure proxy and certificate trust in VS Code settings rather than in a separate CLI install.

Use these settings when your organization requires a proxy or inspects HTTPS traffic:

- Set `http.proxy` to your organization proxy URL.
- Use `http.noProxy` for hosts that should bypass the proxy.
- Leave `http.proxySupport` enabled unless you intentionally want VS Code and Kilo Code to ignore proxy settings.
- Install your organization's root certificate authority in the operating system trust store when HTTPS inspection is in use.
- If the operating system trust store is not enough, set `kilo-code.new.extraCaCerts` to the absolute path of a PEM file that contains the additional certificate authority certificates.
- Keep `http.proxyStrictSSL` enabled whenever possible. Disable it only as a temporary troubleshooting step or when your administrator explicitly requires it, because it disables TLS certificate verification for this path.

Example user or workspace settings:

```json
{
  "http.proxy": "http://proxy.example.com:8080",
  "http.noProxy": ["localhost", "127.0.0.1", ".example.internal"],
  "kilo-code.new.extraCaCerts": "/absolute/path/to/corporate-ca.pem"
}
```

## Contact Support

If you're unable to resolve the issue, please inspect the console logs, remove any secrets, and send the logs to **[hi@kilocode.ai](mailto:hi@kilocode.ai)** along with the following:

- The error messages from the console
- Steps to reproduce the issue
- Screenshots or screen recordings of the issue
- Your IDE and Kilo Code version
