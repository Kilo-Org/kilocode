---
"@kilocode/cli": patch
---

Speed up global config change detection by hashing the global config files with `node:fs` instead of the injected filesystem service.
