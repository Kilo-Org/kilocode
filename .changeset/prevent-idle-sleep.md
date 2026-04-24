---
"@kilocode/cli": minor
---

Prevent the system from sleeping while Kilo is working on a turn. Uses native OS power APIs (IOKit on macOS, PowerCreateRequest on Windows, systemd-inhibit on Linux). Enabled by default; set `prevent_idle_sleep: false` in `kilo.json` to opt out.
