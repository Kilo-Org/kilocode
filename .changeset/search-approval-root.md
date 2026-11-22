---
"@kilocode/cli": patch
"kilo-code": patch
---

The grep and glob tools now resolve the directory they search before they ask for approval, and the approval request records that directory. A search of a named project reference, of a relative path, or of a retained tool-output file names the directory the search uses.
