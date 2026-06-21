---
"kilo-code": patch
---

Fix ReadPermission.harden() respecting EXCLUDED_SUBDIRS — .kilo/plans/*.md is no longer downgraded to "ask" by config dir hardening, matching ConfigProtection exemption semantics.
