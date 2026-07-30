---
"@kilocode/cli": patch
"@kilocode/kilo-telemetry": patch
---

Reduce CLI startup time by deferring Kilo-specific module loading until commands actually run, caching the telemetry profile lookup across invocations, and uploading telemetry in the background so process exit is not delayed by a network round trip
