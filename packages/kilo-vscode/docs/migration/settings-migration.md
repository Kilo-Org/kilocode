# Settings Migration from Old Extension

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6089](https://github.com/Kilo-Org/kilocode/issues/6089)

## Problem

Users upgrading from the old Kilo Code extension have their settings stored in VS Code's `globalState` under the old extension's keys. The new extension uses the CLI's `opencode.json` for configuration. Without migration, users lose all their settings (API keys, model preferences, auto-approve rules, etc.) on upgrade.

## Remaining Work

- On first activation, detect whether the old extension's settings exist in `vscode.ExtensionContext.globalState` or `vscode.workspace.getConfiguration('kilo-code')` (the old extension's config namespace)
- Read relevant settings from the old extension: API keys, provider configuration, model preferences, auto-approve rules, custom instructions, etc.
- Map old settings keys to their new CLI config equivalents in `opencode.json`
- If the CLI config already has settings (user may have manually configured it), show a diff of what would be imported and ask the user to confirm before overwriting
- Write approved settings to the CLI config via the `/global/config` endpoint or directly to `opencode.json`
- Show the user what was migrated and what was not (e.g., settings that have no equivalent)
- Mark migration as complete in `globalState` so it doesn't run again

## Implementation Notes

- Old extension settings namespace: `kilo-code` (VS Code `package.json` `contributes.configuration` prefix)
- The CLI config path is typically `~/.config/opencode/opencode.json` or equivalent
- If the CLI is already configured, prefer showing a diff (VS Code diff editor via `vscode.commands.executeCommand('vscode.diff', ...)`) rather than silently overwriting
