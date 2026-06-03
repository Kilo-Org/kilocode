---
"@kilocode/cli": patch
"@kilocode/kilo-gateway": patch
"@kilocode/kilo-telemetry": patch
---

Make `KILO_API_KEY` consistently override stored Kilo credentials and configured provider tokens across CLI modes, including inference, indexing, server-backed clients, and session synchronization.
