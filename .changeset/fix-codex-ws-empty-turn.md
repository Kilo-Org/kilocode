---
"@kilocode/cli": patch
---

Fix ChatGPT/Codex sessions getting stuck on "Response ended without a finish reason" when the provider's WebSocket stream ends in a failure before producing any output. The turn now surfaces a real provider error and falls back to HTTP instead of silently replaying the same empty response on every resume.
