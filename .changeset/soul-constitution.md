---
"kilo-code": minor
---

Add testable soul constitutions: a per-project SOUL.md values layer that loads at session start and compiles into the system prompt after project instructions. Every axiom must have paired must_refuse and must_not_refuse probes checked at load or the soul is rejected; agents can never edit SOUL.md or its eval artifacts (the permission gate denies it before any configurable rule runs). Ships with deterministic, no-model-grading `kilo soul validate` and `kilo soul eval` CLI commands.
