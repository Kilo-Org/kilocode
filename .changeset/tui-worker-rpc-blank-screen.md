---
"@kilocode/cli": patch
---

Fix the TUI starting up to a permanently blank screen. A request sent to the TUI's worker before it finished starting was dropped, and the TUI then waited for a reply that never came, with no error and no timeout. Worker requests are now queued until the worker is ready, worker-side failures are reported instead of silently swallowed, and a worker that never answers fails with a clear message.
