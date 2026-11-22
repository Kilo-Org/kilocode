---
"@kilocode/cli": patch
---

The explore subagent now asks for approval before it reads secret environment files, as the other built-in agents do. Example environment files stay readable without approval.

On macOS, permission rules for file paths match names the way the volume resolves them, so the same approval applies to a file the volume treats as the same file. Rules for every other resource keep exact matching.
