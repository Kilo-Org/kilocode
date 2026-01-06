---
"@kilocode/cli": patch
---

Add log file rotation to prevent unbounded disk usage

The CLI log file at `~/.kilocode/cli/logs/cli.txt` now automatically rotates at startup when it exceeds 10 MB, keeping only the most recent ~5 MB of logs. This prevents the log file from growing indefinitely and consuming excessive disk space for heavy CLI users or long-running sessions.
