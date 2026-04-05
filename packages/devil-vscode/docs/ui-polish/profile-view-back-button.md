# Profile View Missing Back Button

**Priority:** P2
**Issue:** [#6140](https://github.com/Kilo-Org/kilocode/issues/6140)

Profile now opens in a separate editor panel via `SettingsEditorProvider`, so navigation is handled by VS Code's tab system. Evaluate whether a back button is still needed or if this issue is resolved by the panel-based approach.

## Remaining Work

- Determine if the editor panel approach resolves the original navigation issue
- If not, add a back button to the Profile view header matching the Settings view pattern
