---
"kilo-code": patch
---

Fix the Agent Manager terminal panel getting stranded with no way to close it after switching the terminal button destination to the VS Code terminal. The panel now has a close button that hides it without killing its terminals; switching back and pressing the terminal button reopens them.
