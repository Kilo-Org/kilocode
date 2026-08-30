---
"@kilocode/cli": patch
---

Stop applying plan-mode edit restrictions to custom agents named `architect` or `plan`. The restrictions now apply only to the built-in plan agent, so custom agents — including org or marketplace agents — keep their own configured permissions instead of being locked to plan directories.
