# Clickable Items Should Change the Cursor

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6255](https://github.com/Kilo-Org/kilocode/issues/6255)

## Problem

Interactive elements in the chat (file links, diff headers, tool call rows, buttons without clear button styling) do not change the mouse cursor to `pointer` on hover. Users can't tell what is clickable.

## Remaining Work

- Audit all interactive elements in the chat message area and ensure they have `cursor: pointer` set
- Specifically check: file path links, diff expand/collapse headers, tool call rows, MCP tool entries, any clickable text spans
- Links rendered inside markdown content should also show `pointer` cursor (check the markdown CSS)
- Apply globally where possible via a CSS rule on `[role="button"], button, a, [onClick]` selectors, but also patch individual components that override cursor

## Implementation Notes

- This is a CSS-only change in `webview-ui/src/styles/chat.css` and/or kilo-ui component styles
- VS Code webviews reset most default browser styles; `cursor: pointer` must be explicitly set
