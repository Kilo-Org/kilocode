---
"@roo-code/vscode-webview": patch
---

fix: remove double scrollbar in model selector

Removed nested overflow-y-auto divs that were creating duplicate scrollable containers. The contentClassName prop now has complete control over scroll behavior.
