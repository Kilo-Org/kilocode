---
"@kilocode/cli": patch
---

Fix startup hang in very large repositories (e.g. jetbrains/intellij-community) by skipping redundant `fs.stat` calls on already-tracked files during snapshot tracking. Only untracked candidates need the size check, cutting snapshot work on huge repos from tens of thousands of syscalls per turn to the small set of actually-new files.
