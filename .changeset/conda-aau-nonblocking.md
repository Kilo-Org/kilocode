---
"@kilocode/kilo-telemetry": patch
---

Read the conda anonymous client id from disk during startup instead of waiting on `conda info`, and skip it when conda telemetry is turned off.
