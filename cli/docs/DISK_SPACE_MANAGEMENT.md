# Managing Disk Space

The Kilo Code CLI stores task history in `~/.kilocode/cli/` (or `%USERPROFILE%\.kilocode\cli\` on Windows). With heavy usage, this directory can grow significantly.

## Manual Cleanup

Delete the CLI data directory to free disk space:

**macOS/Linux:**

```bash
rm -rf ~/.kilocode/cli/global/tasks/*
```

**Windows (PowerShell):**

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.kilocode\cli\global\tasks\*"
```

**Windows (Command Prompt):**

```cmd
del /s /q "%USERPROFILE%\.kilocode\cli\global\tasks\*"
rmdir /s /q "%USERPROFILE%\.kilocode\cli\global\tasks"
mkdir "%USERPROFILE%\.kilocode\cli\global\tasks"
```

> **Note:** This deletes all task history but preserves your configuration (API keys, settings).

## CLI Auto-Purge Configuration

The CLI has a built-in auto-purge feature that automatically cleans up old tasks on startup. Add the following to your `~/.kilocode/cli/config.json` (or `%USERPROFILE%\.kilocode\cli\config.json` on Windows):

```json
{
	"autoPurge": {
		"enabled": true,
		"defaultRetentionDays": 30,
		"favoritedTaskRetentionDays": null,
		"completedTaskRetentionDays": 30,
		"incompleteTaskRetentionDays": 30
	}
}
```

### Configuration Options

| Option                        | Type           | Default | Description                                     |
| ----------------------------- | -------------- | ------- | ----------------------------------------------- |
| `enabled`                     | boolean        | `false` | Enable automatic cleanup                        |
| `defaultRetentionDays`        | number         | `30`    | Fallback retention period                       |
| `favoritedTaskRetentionDays`  | number \| null | `null`  | Days to keep favorited tasks (`null` = forever) |
| `completedTaskRetentionDays`  | number         | `30`    | Days to keep completed tasks                    |
| `incompleteTaskRetentionDays` | number         | `30`    | Days to keep incomplete tasks                   |

> **Tip:** Set `favoritedTaskRetentionDays` to `null` to preserve important tasks indefinitely.

## Using the VS Code Extension

If you also use the Kilo Code VS Code extension, you can enable automatic task history cleanup:

1. Open VS Code Settings (`Cmd+,` / `Ctrl+,`)
2. Search for "Kilo Code auto purge"
3. Enable **Auto Purge** and configure retention periods

The extension's auto-purge feature runs daily and removes old tasks based on configurable retention periods for different task types (favorited, completed, incomplete).
