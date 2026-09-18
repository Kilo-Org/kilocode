---
"@kilocode/cli": patch
---

Keep the model's behaviour in sync with the selected agent after switching. Every agent change now adds one reminder that names the previous and current agent and states whether the current agent may modify files, based on its configured permissions. This covers built-in, custom, and organization agents, and fixes Ask still trying to edit files after switching from Code back to Ask.
