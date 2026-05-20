---
"kilo-code": patch
---

Fix stale indexing status updates in the VS Code extension on Windows so Settings and the chat indicator refresh while indexing progresses. Directory matching for indexing SSE events now handles Windows path casing, and indexing status pushes are no longer dropped if they arrive before the initial config payload.
