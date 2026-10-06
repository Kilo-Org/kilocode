---
"kilo-code": patch
"@kilocode/cli": patch
---

Reduce CPU use of the workspace scan for marketplace suggestions. The scan now respects `.gitignore` and other ignore files, searches all file patterns in one pass, and no longer follows symbolic links out of the project. Creating a file no longer starts a new scan unless the file or folder can match a suggestion.
