---
"@kilocode/cli": minor
---

Route `kilo-auto/custom/<slug>` auto routers on the client: the CLI registers
its own provider models as router entries (`kilo auto router add|remove|list`),
asks the auto-routing service for a decision when it can serve one of them, and
runs the picked model locally. `kilo auto eval <router>` runs the missing
client evals in Docker and uploads each result as it finishes.
