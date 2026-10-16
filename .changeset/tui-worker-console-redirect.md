---
"@kilocode/cli": patch
---

Keep stray console output from dependencies out of the TUI. Warnings written straight to the terminal by libraries running in the session worker — for example the MCP SDK's notice about OAuth tokens saved without an `issuer` — used to land on top of the rendered screen and stay there until a redraw, leaving the splash screen or chat view shredded. Those writes now go to the log file instead.
