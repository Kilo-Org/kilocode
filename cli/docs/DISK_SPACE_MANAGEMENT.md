# Managing Disk Space

The Kilo Code CLI stores task history in `~/.kilocode/cli/` (or `%USERPROFILE%\.kilocode\cli\` on Windows). With heavy usage, this directory can grow significantly.

## Cleanup Command

Use the CLI to clean up stored data without manual deletion:

```bash
# Default cleanup (logs, tasks, command history)
kilocode cleanup

# Show what would be deleted
kilocode cleanup --dry-run

# Remove everything including config and identity
kilocode cleanup --all --yes
```

## Manual Cleanup

Delete the CLI data directory to free disk space:

**macOS/Linux:**

```bash
rm -rf ~/.kilocode/cli
```

**Windows (PowerShell):**

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.kilocode\cli"
```

**Windows (Command Prompt):**

```cmd
rmdir /s /q "%USERPROFILE%\.kilocode\cli"
```

> **Note:** This deletes all task history. The directory will be recreated on next CLI use.

## Using the VS Code Extension

If you also use the Kilo Code VS Code extension, you can enable automatic task history cleanup:

1. Open VS Code Settings (`Cmd+,` / `Ctrl+,`)
2. Search for "Kilo Code auto purge"
3. Enable **Auto Purge** and configure retention periods

The extension's auto-purge feature runs daily and removes old tasks based on configurable retention periods for different task types (favorited, completed, incomplete).
