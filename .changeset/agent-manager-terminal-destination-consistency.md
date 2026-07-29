---
"kilo-code": patch
---

Keep each Agent Manager panel's terminal destination consistent. A dropdown pick is now remembered per panel and no longer flips when another window rewrites the shared terminal destination setting, so the terminal shortcut keeps opening the terminal type that panel is actually using. The shortcut also no longer dead-ends on worktrees without an active session, and terminals left over from a reloaded webview are cleaned up instead of leaking.
