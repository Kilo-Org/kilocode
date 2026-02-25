# Upgrade Onboarding Experience

**Priority:** P1
**Status:** ❌ Not started
**Issue:** [#6188](https://github.com/Kilo-Org/kilocode/issues/6188)

## Problem

When the new extension activates for a user who has previously used the old extension, it greets them with a generic "Welcome to Kilo" screen — as if they're a brand-new user. Their old sessions are not visible, and there is no explanation of what changed or what they need to do next.

This is disorienting for longtime users.

## Remaining Work

- Detect whether the user is an upgrader (had the old extension installed — check for old `globalState` keys or old workspace settings)
- Show a distinct onboarding screen for upgraders that:
  - Acknowledges they are an existing user
  - Explains that the new extension uses a different backend (Kilo CLI) and sessions are not directly imported
  - Shows what settings have been migrated (link to settings migration) and what hasn't
  - Offers a button to go to the session migration flow if available
  - Links to documentation on what changed and how to get started with the new extension
- Do not show the generic "new user" welcome screen to upgraders

## Implementation Notes

- The detection can be done by checking for any key in `vscode.ExtensionContext.globalState` that the old extension would have written (e.g., `kilo-code.taskHistory`, etc.)
- Store a flag `kilo-code.new.upgradeOnboardingShown` in `globalState` after displaying; do not show again
- The onboarding can be a webview panel or a sequence of VS Code notifications/modals
