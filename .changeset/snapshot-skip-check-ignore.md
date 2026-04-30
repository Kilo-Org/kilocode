---
"@kilocode/cli": patch
---

Fix a startup hang in very large repositories (e.g. intellij-community, ~75k+ files) by avoiding a `git check-ignore` pass over the full file list during snapshot tracking.
