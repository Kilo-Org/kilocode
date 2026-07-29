---
"@kilocode/cli": patch
"kilo-code": patch
---

Stop flashing a "Turn interrupted" warning when a follow-up message is queued while the assistant is still working. The running turn now closes with a dedicated "superseded" reason instead of "interrupted" when it hands off to the queued prompt, so the premature-stop warning only appears for real interruptions.
