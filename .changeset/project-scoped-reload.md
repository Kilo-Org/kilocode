---
"@kilocode/cli": minor
"kilo-code": patch
---

Reload the entire project for `/reload` and the reload actions. A reload from an Agent Manager worktree now reboots every loaded instance of the same project, so a project config change applies to the main checkout and all worktrees. The reload is refused while any session in the project is running.
