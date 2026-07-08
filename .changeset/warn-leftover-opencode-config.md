---
"@kilocode/cli": patch
---

Show a dismissible notification when a leftover opencode config directory is found. Kilo no longer falls back to opencode configuration, so the notice points you to move `.opencode` config into a `.kilo` directory (or the global kilo config dir). Dismiss it once and it won't return unless the directory is still present.
