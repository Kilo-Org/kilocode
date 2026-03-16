# Upgrade Onboarding Experience

**Priority:** P1
**Issue:** [#6188](https://github.com/Kilo-Org/kilocode/issues/6188)

## Remaining Work

- Detect upgraders by checking for old `globalState` keys (e.g., `kilo-code.taskHistory`)
- Show distinct onboarding screen that:
  - Acknowledges they are an existing user
  - Explains the new CLI backend and that sessions are not directly imported
  - Shows what settings have been migrated and what hasn't
  - Offers a button to the session migration flow if available
  - Links to documentation on what changed
- Do not show generic "new user" welcome screen to upgraders
- Store `kilo-code.new.upgradeOnboardingShown` flag in `globalState`
