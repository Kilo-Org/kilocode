---
"@kilocode/cli": minor
---

Add an experimental autonomous engine for `/goal`, off by default and enabled with `autonomous_goal.enabled`. When enabled, `/goal <objective>` plans a task graph, routes each task to a local or cloud model, runs project checks, reviews and repairs the work, and finishes only after a final review. `/goal status`, `tasks` and `budget` show progress, and cloud spend is capped by the `autonomous_goal.budget` limits. Headless `kilo run --command goal <objective>` works when the engine is enabled.
