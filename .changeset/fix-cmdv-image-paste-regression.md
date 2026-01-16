---
"@kilocode/cli": patch
---

Fix Cmd+V image paste regression in VSCode terminal

Restores the ability to paste images using Cmd+V in VSCode terminal, which was broken in #4916. VSCode sends empty bracketed paste sequences for Cmd+V (unlike regular terminals that send key events), so we need to check the clipboard for images when receiving an empty paste.
