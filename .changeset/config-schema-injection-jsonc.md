---
"@kilocode/cli": patch
---

Fix: inject `$schema` into config files using jsonc-parser, avoiding write-on-read for comment-first JSONC and preventing unnecessary file rewrites on every load
