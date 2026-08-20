---
"@kilocode/cli": patch
---

Keep TUI reasoning output painting while a turn is still running, recover live text deltas that arrive before their part, resync a busy session after a few seconds without new output, and keep the event stream reconnecting after transient errors.
