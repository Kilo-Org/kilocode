---
"@kilocode/kilo-jetbrains": patch
---

Regenerate bun.lock so the workspace entry for @kilocode/kilo-jetbrains matches package.json, and add a CI guard that fails when workspace package versions drift from bun.lock.