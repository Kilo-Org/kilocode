---
"@kilocode/kilo-jetbrains": patch
---

Add a **Share usage analytics** toggle under Settings → Tools → Kilo Code → Advanced to turn product telemetry off in the JetBrains plugin. It edits `experimental.openTelemetry` in the global Kilo config, and the plugin no longer re-enables telemetry over that setting or `KILO_TELEMETRY_LEVEL`.
