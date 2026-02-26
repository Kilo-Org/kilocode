# Profile View Missing Back Button

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6140](https://github.com/Kilo-Org/kilocode/issues/6140)

## Problem

The Profile view has no way to navigate back to the chat. Users who open the Profile page are stuck and must reload the extension or find another workaround.

The Settings view already has a back button (arrow-left icon in the header) that returns to the chat. The Profile view should have the same.

## Remaining Work

- Add a back button to the Profile view header, matching the pattern used in the Settings view
- The back button should navigate back to the chat/home view
- Use the same arrow-left icon and header layout as Settings for visual consistency

## Implementation Notes

- The Profile view component lives in `webview-ui/src/`
- Copy the back button pattern from the Settings view header
- This is a purely webview-side change
