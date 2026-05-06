---
"kilo-code": patch
"@kilocode/cli": patch
---

Fix a class of unexpected logouts where `auth.json` could be silently wiped when it was partially written (e.g. after a crash or OS sleep) or temporarily unreadable. Writes are now atomic and read errors no longer cause other providers' credentials to be overwritten.
