---
"@kilocode/kilo-jetbrains": patch
---

Respect a `KILO_TELEMETRY_LEVEL=off` environment variable and `experimental.openTelemetry: false` in the global config instead of re-enabling CLI telemetry in the JetBrains plugin.
