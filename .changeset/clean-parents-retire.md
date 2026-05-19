---
"kilo-code": patch
---

Fix memory leak: prune stale `sessionOverrides` entries outside of Solid's `produce()` draft to prevent unbounded accumulation and webview OOM crashes.

