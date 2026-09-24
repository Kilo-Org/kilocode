---
"@kilocode/cli": patch
"kilo-code": patch
---

Surface an error when a config change (e.g. flipping a permission from "Ask" to "Allow") is saved to one config file but a higher-priority file such as `opencode.json` still overrides it, instead of silently keeping the old effective value. Config validation and write failures are also reported with the file and issue details instead of an opaque server error.
