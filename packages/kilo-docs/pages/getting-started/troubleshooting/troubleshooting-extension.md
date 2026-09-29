---
title: "Troubleshooting IDE Extensions"
description: "How to capture console logs and report issues with Kilo Code"
---

# Capturing Console Logs

Providing console logs helps us pinpoint exactly what's going wrong with your installation, network, or MCP setup. This guide walks you through capturing those logs in your IDE.

## Opening Developer Tools

1. **Open the Command Palette**: Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. **Search for Developer Tools**: Type `Developer: Open Webview Developer Tools` and select it

## Capturing the Error

Once you have the Developer Tools console open:

1. **Clear previous logs**: Click the "Clear Console" button (🚫 icon at the top of the Console panel) to remove old messages
2. **Reproduce the issue**: Perform the action that was causing problems
3. **Check for errors**: Look at the Console tab for error messages (usually shown in red). If you suspect connection issues, also check the **Network** tab
4. **Copy the logs**: Right-click in the console and select "Save as..." or copy the relevant error messages

## SQLite database is malformed

If every prompt fails with `SQLiteError: database disk image is malformed`, Kilo Code's local SQLite database may be corrupted. This database stores local Kilo state such as sessions and history.

### Find the database

When the kilo CLI uses the same environment as the affected installation, run `kilo db path` to print the selected database. See [Session History and Search](/docs/code-with-ai/agents/session-history) for normal database inspection and search workflows.

The default database location depends on where Kilo Code is running:

| Environment | Database path |
|---|---|
| Windows | `%USERPROFILE%\.local\share\kilo\kilo.db` |
| macOS | `~/.local/share/kilo/kilo.db` |
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

## Diagnosing WSL disconnects

If you use Kilo Code with VS Code on WSL and the extension repeatedly disconnects — VS Code shows "reconnecting" or the Kilo backend stops responding — capture a diagnostic bundle **before** restarting WSL or rebooting. A restart wipes most of the evidence.

1. Open any WSL terminal. An already-open Windows Terminal tab with your distribution works fine, even while VS Code is still reconnecting.

2. Paste this single command:

   ```bash
   OUT=/tmp/kilo-diag-$(date +%Y%m%dT%H%M%S) && mkdir -p $OUT && { echo "--- date"; date; echo "--- uptime"; uptime; echo "--- free"; free -h; echo "--- oom/kills"; sudo dmesg -T | grep -iE "oom|out of memory|killed process" | tail -60; } > $OUT/system.txt 2>&1; cp -r ~/.vscode-server/data/logs $OUT/vscode-logs 2>/dev/null; cp -r ~/.vscode-server-insiders/data/logs $OUT/vscode-insiders-logs 2>/dev/null; cp -r ~/.local/share/kilo/log $OUT/kilo-logs 2>/dev/null; tar czf /mnt/c/Users/Public/kilo-diag.tgz -C /tmp $(basename $OUT) && echo "Done -> C:\\Users\\Public\\kilo-diag.tgz"
   ```

   It may ask for your sudo password. The command collects kernel out-of-memory events, WSL VM uptime (which shows whether the whole VM restarted or just the VS Code server died), current memory stats, the VS Code remote server logs, and Kilo logs — nothing else.

   {% callout type="warning" %}
   Inspect the bundle before sharing it and remove any secrets such as API keys, tokens, prompts, or file paths. The bundle is written to `C:\Users\Public`, a folder shared with Windows so you can access it outside WSL — delete it once you're done sharing it.
   {% /callout %}

3. When it prints `Done`, send us the file `C:\Users\Public\kilo-diag.tgz` from Windows.

4. Include roughly how many Agent Manager sessions or worktrees were running in parallel when the disconnect happened.

## Contact Support

If you're unable to resolve the issue, please inspect the console logs, remove any secrets, and send the logs to **[hi@kilocode.ai](mailto:hi@kilocode.ai)** along with the following:

- The error messages from the console
- Steps to reproduce the issue
- Screenshots or screen recordings of the issue
- Your IDE and Kilo Code version
