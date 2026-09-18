---
"kilo-code": minor
---

Reintroduce Auto-Cleanup for task history as a backend-owned retention policy. Off by default; when enabled in Settings → Checkpoints (stored in `kilo.json` under `retention`), it deletes sessions older than a configurable age across all projects and every Kilo client on the machine. Running tasks and tasks with a recent fork are never deleted, and "Run Cleanup Now" asks for confirmation first.
