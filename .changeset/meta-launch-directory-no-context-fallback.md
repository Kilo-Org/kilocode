---
"kilo-code": patch
---

Fix a crash when session repository metadata is resolved without an instance context (e.g. the API fallback path): it now degrades to no git metadata instead of throwing.
