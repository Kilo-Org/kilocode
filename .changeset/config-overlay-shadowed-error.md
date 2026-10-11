---
"@kilocode/cli": patch
---

Report an error instead of silently keeping the old value when a config change is overridden by a higher-priority file such as `opencode.json`. Config validation and write failures now return the file and issue details instead of an opaque server error.
