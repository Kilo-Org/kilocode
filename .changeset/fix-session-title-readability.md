---
"webview-ui": patch
---

Fix unreadable text and poor contrast issues in Agent Manager

**Session list item (issue #5618):**

- Change selected session item background from list-activeSelectionBackground to button-background for better contrast
- Change selected session item text color from list-activeSelectionForeground to button-foreground

**Session detail view:**

- Change session header, messages container, and chat input backgrounds from editor-background to sideBar-background
- Add explicit text color to session title using titleBar-activeForeground
- Add explicit color to messages container using sideBar-foreground
