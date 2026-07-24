---
"@kilocode/cli": patch
---

Fix a fatal startup crash ("attempt to write a readonly database") when the local database or its WAL sidecar files lost write permission. Kilo now repairs the permissions automatically when it safely can, and otherwise reports the exact file to fix instead of an opaque error.
