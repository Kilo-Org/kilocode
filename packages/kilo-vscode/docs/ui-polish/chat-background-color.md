# Chat Background Color Should Differ from Editor

**Priority:** P2
**Status:** 🔨 Partial (assigned)
**Issue:** [#6276](https://github.com/Kilo-Org/kilocode/issues/6276)

## Problem

The chat panel uses the same background color as the VS Code editor (`editor.background`). This makes the extension blend into the editor area, with only a thin border separating them. Other panels in VS Code (Explorer, Source Control, etc.) typically use `sideBar.background`, which is intentionally distinct.

## Remaining Work

- Change the webview's root background color from `editor.background` (or no explicit color) to `sideBar.background`
- Use the VS Code CSS variable `--vscode-sideBar-background` which is already injected into webviews
- Verify the change looks correct in multiple themes — dark, light, and high-contrast; the sidebar background is typically slightly darker/lighter than the editor background

## Implementation Notes

- The background color is likely set in `webview-ui/src/styles/chat.css` or on the root element in `index.tsx`
- Replace with `var(--vscode-sideBar-background)` or `var(--vscode-panel-background)` depending on which token is more appropriate for a sidebar panel
