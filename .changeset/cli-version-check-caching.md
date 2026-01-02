---
"@kilocode/cli": patch
---

Added caching to version update checker to avoid checking npm registry on every CLI invocation. The CLI now caches version check results for 24 hours, reducing network requests and improving startup performance.
