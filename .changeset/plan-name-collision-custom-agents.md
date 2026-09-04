---
"@kilocode/cli": patch
---

Stop applying plan-mode edit restrictions to custom agents named `architect`. The restrictions now apply only to the built-in plan agent, so a custom architect — including an org or marketplace agent — keeps its own configured edit permissions instead of being locked to plan directories.
