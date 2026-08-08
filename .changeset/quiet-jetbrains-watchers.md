---
"@kilocode/cli": patch
---

Fix high CPU and runaway memory growth in the JetBrains background `kilo serve` process on macOS by no longer eagerly starting native file watchers, matching the VS Code backend.
