---
"@kilocode/kilo-memory": patch
"@kilocode/cli": patch
---

Log memory parse failures (including the full model output) and capture-decision records at DEBUG level. Visible by default in source/dev runs; in release builds set `KILO_LOG_LEVEL=DEBUG` or pass `--logLevel DEBUG`.
