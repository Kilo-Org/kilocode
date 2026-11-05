---
"@kilocode/kilo-gateway": patch
---

Keep device authorization login polling alive through transient errors (a single 5xx or network blip no longer aborts the sign-in flow); the last poll error is thrown only once all attempts are exhausted.
