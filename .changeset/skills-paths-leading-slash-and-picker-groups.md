---
"@kilocode/cli": patch
"kilo-code": patch
---

Load skills from `skills.paths` entries written with a leading slash, such as `/.github/skills`, by falling back to the project root when no such directory exists at the filesystem root. Show skills in the VS Code slash menu under their own Skills group and list a skill that shares a name with a command as `/name:skill`.
