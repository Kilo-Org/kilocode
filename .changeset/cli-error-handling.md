---
"@kilocode/cli": patch
---

Add error handling to prevent silent CLI failures

Added uncaught exception and unhandled rejection handlers to ensure
errors are displayed to users instead of exiting silently.
