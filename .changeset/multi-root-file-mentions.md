---
"kilo-code": minor
"@kilocode/cli": patch
---

Suggest files from every folder in a multi-root VS Code workspace when typing `@`, so folders added through "Add Folder to Workspace..." are mentionable without the file picker. Files outside the session's own project are still read only after the usual approval, and `semantic_search` now reports which root it covers and whether its index was complete, so an empty result is no longer mistaken for missing code.
