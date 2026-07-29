---
"@kilocode/cli": minor
---

Support executing shell commands embedded in skill files. Commands written as `` !`command` `` in a SKILL.md run and their output is inlined into the skill. Only trusted skills can run commands and `KILO_DISABLE_SKILL_SHELL` disables the behavior; when the model loads a skill, the commands are shown in a single up-front approval before running.
