---
"kilo-code": patch
---

Include basic-auth credentials in the Local and Network Console URLs printed by `kilo console`, so users on headless hosts (no `DISPLAY`/`WAYLAND_DISPLAY`, SSH sessions, CI runners) can open the URL in a browser on another machine and reach the Console.