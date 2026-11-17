---
"@kilocode/cli": minor
---

Add `kilo browser-hub` and `kilo browser install-host`. The hub is the local transport between the CLI and the Kilo browser extension: it runs as a browser-started native messaging host or as a detached loopback WebSocket with a pairing page, multiplexes CLI connections over a per-user socket, and registers itself so CLIs find it automatically. `install-host` writes the native messaging host manifests for Chrome, Edge, Brave, Arc, Vivaldi, Opera and Firefox on macOS, Linux, and Windows.
