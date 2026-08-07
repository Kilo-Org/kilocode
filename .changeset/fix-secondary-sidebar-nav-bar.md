---
"kilo-code": patch
---

Fix the sidebar navigation bar (New Task, History, Agent Manager, KiloClaw, Marketplace, Profile, Settings) disappearing in Cursor when the Kilo Code view is docked in the Secondary Side Bar. Cursor now renders the navigation inside the webview itself so it stays visible regardless of dock location. VS Code is unaffected — it continues to use its native title bar toolbar, which already worked correctly everywhere.
