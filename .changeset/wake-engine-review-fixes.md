---
"@kilocode/cli": patch
---

Background-process wake events now reach the active session even after an instance reload, surface a clear "Invalid wake pattern" error when the wake pattern is malformed, and stay within an 8 MiB retention cap.
