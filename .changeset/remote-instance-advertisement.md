---
"@kilocode/cli": minor
---

`kilo remote` instances now advertise themselves on the relay heartbeat. Each heartbeat carries the host's hostname, the project directory name, and the CLI build version, and each session entry advertises the platform it was created on. The cloud relay learns about a freshly-connected instance immediately (no 10s wait for the first timer tick), and the advertisement is race-safe across the explicit `kilo remote` command and bootstrap auto-enable (`KILO_REMOTE=1` / `remote_control` config). Legacy CLIs that send neither field remain wire-compatible.
