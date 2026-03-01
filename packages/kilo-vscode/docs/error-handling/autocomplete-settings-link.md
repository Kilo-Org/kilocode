# Autocomplete Broken Notice — Settings Link Not Clickable

**Priority:** P1
**Status:** ❌ Not started
**Issue:** [#6284](https://github.com/Kilo-Org/kilocode/issues/6284)

## Problem

The VS Code status bar or a notification reports that autocomplete is broken, but the "settings" link in the message is not clickable. Users cannot navigate to the autocomplete settings to fix the issue.

Additionally, the autocomplete model selector shows no model selected even though the user has not changed any autocomplete settings.

## Remaining Work

- Fix the "settings" link in the autocomplete broken notice: it should navigate to the Autocomplete tab in the Settings view
- If the link is inside the webview, ensure it fires the correct navigation action
- If it is a VS Code notification or status bar item, use `vscode.commands.executeCommand` to open the settings view on the autocomplete tab
- Investigate why the autocomplete model selector shows "no model selected" for users who haven't explicitly configured it — add a sensible default fallback
- Check whether the "autocomplete broken" state is correctly detected and cleared when the user fixes the configuration

## Implementation Notes

- The autocomplete status lives in the status bar item registered by the extension
- The "settings" link may need to be a command URI (`vscode:command:kilo-code.new.openSettings?tab=autocomplete`) rather than a plain text link
