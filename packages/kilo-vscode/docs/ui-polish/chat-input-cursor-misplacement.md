# Chat Input Cursor Misplacement

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6087](https://github.com/Kilo-Org/kilocode/issues/6087)

## Problem

After typing a long prompt (roughly 10+ lines, especially with pasted content), the cursor in the chat textarea becomes visually decoupled from the actual insertion point. The cursor renders in the wrong position while text continues to be inserted at a different location.

## Remaining Work

- Reproduce the issue: open the extension, paste a large block of text into the chat input, then continue typing until several line-wraps occur
- Investigate whether the textarea has a fixed height that isn't auto-resizing correctly, causing scroll offset to desync from cursor position
- Check if the issue is in a `<textarea>` element or a custom contenteditable div; the fix differs significantly
- For a `<textarea>`: ensure `height` is recalculated after each input event (listen to `input`, set `element.style.height = 'auto'` then `element.style.height = element.scrollHeight + 'px'`)
- For contenteditable: check for CSS `transform` or absolute positioning that might shift the rendered cursor

## Implementation Notes

- The chat input component lives in `webview-ui/src/`
- This is a webview-only fix — no extension host changes needed
