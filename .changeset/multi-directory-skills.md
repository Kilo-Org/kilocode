---
"kilo-code": minor
---

Support multiple context directories for skills discovery. Skills can now be loaded from both `.kilocode/skills/` and `.claude/skills/` directories, allowing users with existing Claude configurations to reuse their skills. The `.kilocode` directory takes precedence when the same skill exists in both locations.
