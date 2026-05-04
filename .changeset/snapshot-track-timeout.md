---
"@kilocode/cli": patch
---

Show an "Initializing snapshot…" line in the chat while the initial snapshot is running on very large repositories, and add an interactive prompt when it stalls. After 10 seconds (configurable via `KILO_SNAPSHOT_TRACK_TIMEOUT_MS`) the prompt asks whether to keep waiting or disable snapshots for the project; choosing to disable writes `"snapshot": false` to `.kilo/kilo.json` so future sessions skip snapshots entirely.
