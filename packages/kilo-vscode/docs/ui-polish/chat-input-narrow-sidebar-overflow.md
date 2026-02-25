# Chat Input Overflows on Narrow Sidebar

**Priority:** P2
**Status:** ❌ Not started
**Issue:** [#6273](https://github.com/Kilo-Org/kilocode/issues/6273)

## Problem

When the sidebar is narrow, the model selector dropdown, variant selector, and send button row overflows horizontally off-screen. The buttons become inaccessible.

## Remaining Work

- Make the chat input toolbar responsive: when the available width is too small to show all controls in one row, wrap them to a second row
- The send button should always remain visible and ideally stay anchored to the bottom-right
- The model/variant selectors can wrap to a row above the input textarea when needed
- Use CSS flexbox `flex-wrap: wrap` or a media-query-like approach using container queries (or `ResizeObserver` in JS)
- Test at sidebar widths of ~200px, ~280px, and ~350px

## Implementation Notes

- The chat input component is in `webview-ui/src/`
- VS Code sidebar width is not directly controllable, so the layout must be purely CSS-responsive
