---
"@kilocode/cli": patch
---

Show network-disconnect errors inline in the TUI instead of appearing to hang: the error (e.g. "Connection refused") is displayed with a "waiting for network" hint while the session waits for connectivity, and it resumes automatically once the network is back. Requests that stall on a dead connection are now detected after ~10 seconds of provider silence instead of hanging forever: they wait for connectivity when nothing has streamed yet, or surface a visible network error when output was already received.
