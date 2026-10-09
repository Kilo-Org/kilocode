---
"@kilocode/cli": patch
---

Stop persistent background processes on Windows from adopting unrelated processes. A persistent process no longer keeps running after its command and its real child processes have ended, and stopping it no longer terminates programs it never started.
