---
"@kilocode/cli": patch
"kilo-code": patch
---

Ignore `{file:...}` and `{env:...}` references inside `/* */` and trailing `//` comments of config files such as `kilo.jsonc` and `tui.jsonc`, so a reference mentioned in a comment no longer makes the config invalid.
