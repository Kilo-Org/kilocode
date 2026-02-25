# Context Compression Icon

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6081](https://github.com/Kilo-Org/kilocode/issues/6081)

## Problem

The context compression button in the chat header uses an icon that users mistake for a close/dismiss button. Its placement near the top-right of the chat adds to the confusion. Users have accidentally triggered context compression thinking they were closing something.

## Remaining Work

- Replace the current icon with one that more clearly conveys "compress" or "summarize context" — not an X or close glyph
- Consider adding a tooltip label so the action is unambiguous on hover
- Check kilo-ui icon set for a suitable alternative (e.g., a compress/fold icon); if none exists, add one
- Evaluate placement: moving the button away from the close-button region may also help

## Implementation Notes

- The button is rendered in the chat toolbar in the webview (`webview-ui/src/`)
- This is a purely webview-side change — no extension host or CLI involvement needed
