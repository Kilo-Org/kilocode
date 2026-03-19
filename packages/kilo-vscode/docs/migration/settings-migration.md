# Settings Migration from Old Extension

**Priority:** P1
**Issue:** [#6089](https://github.com/Kilo-Org/kilocode/issues/6089)

## Remaining Work

- On first activation, detect whether old extension settings exist in `vscode.ExtensionContext.globalState` or `vscode.workspace.getConfiguration('kilo-code')`
- Read relevant settings: API keys, provider configuration, model preferences, auto-approve rules, custom instructions
- Map old settings keys to CLI config equivalents in `opencode.json`
- If CLI config already has settings, show a diff and ask user to confirm before overwriting
- Write approved settings to CLI config via `/global/config` endpoint or directly to `opencode.json`
- Show what was migrated and what was not
- Mark migration as complete in `globalState` so it doesn't run again
