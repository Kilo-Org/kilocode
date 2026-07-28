---
"@kilocode/cli": minor
---

Support executing shell commands embedded in skill files. Commands written as `` !`command` `` in a SKILL.md run when the skill loads and their output is inlined into the skill, gated by a single up-front approval that lists every command. Only trusted skills can run commands, and `KILO_DISABLE_SKILL_SHELL` disables the behavior.
