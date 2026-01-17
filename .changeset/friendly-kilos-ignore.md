---
"kilo-code": minor
---

feat: add .kiloignore as an alias for .kilocodeignore (fixes #3825)

Users can now use either `.kiloignore` or `.kilocodeignore` to specify files that should be blocked from LLM access. The `.kilocodeignore` file takes precedence if both exist.

This addresses user confusion reported in issue #3825 where users expected `.kiloignore` to work similar to other ignore files.
