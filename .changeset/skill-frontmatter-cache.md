---
"@kilocode/cli": patch
---

Keep every project skill available when one Kilo server handles several folders, such as Agent Manager worktrees. Skills whose frontmatter has an unquoted colon (for example `description: Use when: ...`) no longer go missing with "Skill not found" after the first folder loads.
