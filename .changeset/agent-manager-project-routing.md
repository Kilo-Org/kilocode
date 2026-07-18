---
"kilo-code": minor
---

Add a projectId routing layer to the Agent Manager so repository operations can target a registered project instead of always resolving through `workspaceFolders[0]`. The legacy single-project path is preserved; a registered project root takes precedence when the new path is present.
