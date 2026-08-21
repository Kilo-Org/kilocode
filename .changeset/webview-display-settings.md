---
"kilo-code": minor
---

Add opt-in Display settings for the VS Code chat UI, all defaulting to current behavior so out-of-box appearance is unchanged:

- **Reasoning Display**: choose how reasoning blocks appear while the agent is thinking and after it finishes — collapsed, preview while thinking then collapse, full while thinking then collapse, or full and stay open (default). Supersedes the deprecated `auto_collapse_reasoning` boolean, which is still honored for existing configs.
- **Highlight Inline Code**: render inline code spans with a theme-aware background and spacing (off by default).
- **Inline Code Color**: set a hex color for inline code spans (defaults to the editor theme).
- **Diff Line Backgrounds**: fill added/removed diff lines with a background color like the editor diff view (off by default).
