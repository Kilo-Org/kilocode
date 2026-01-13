---
"@kilocode/cli": patch
---

Fix Windows cmd.exe display bug with escape sequences

On Windows cmd.exe, the `\x1b[3J` (clear scrollback buffer) escape sequence is not properly supported and causes display artifacts like raw escape sequences appearing in the output (e.g., `[\r\n\t...]`). This fix:

- Adds platform detection for Windows terminals
- Uses a Windows-safe clear sequence that omits `\x1b[3J`
- Provides utility functions for normalizing line endings between Windows (CRLF) and Unix (LF)
