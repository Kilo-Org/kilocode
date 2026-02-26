# Show Changelog on Extension Update

**Priority:** P3
**Status:** 🔨 Partial (assigned)
**Issue:** [#6079](https://github.com/Kilo-Org/kilocode/issues/6079)

## Problem

When the extension updates, users are not notified of what changed. They have no way to discover new features or understand bug fixes without manually navigating to the marketplace.

## Remaining Work

- On activation, compare the current extension version (`context.extension.packageJSON.version`) against the last-seen version stored in `globalState`
- If the version has changed (i.e., an update just occurred), show a notification:
  - `vscode.window.showInformationMessage('Kilo Code updated to v${version}', "What's New", 'Dismiss')`
  - "What's New" should either open a webview panel rendering the changelog, or open the browser to the CHANGELOG.md on GitHub/marketplace
- Update the stored version in `globalState` after showing the notification
- Do not show on first install (when there is no previous version in `globalState`)

## Implementation Notes

- A simple approach: open the browser to the GitHub releases page or the CHANGELOG.md URL
- A richer approach: show a webview panel rendering the relevant section of `CHANGELOG.md` bundled with the extension
- The check should happen in `activate()` in `src/extension.ts`
