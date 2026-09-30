---
"@kilocode/cli": patch
---

Restrict session PR linking, automatic recording, and background polling to CLI backends. VS Code, Agent Manager, JetBrains, and other clients keep their existing PR integrations without running the separate session-link mechanism, including when controlled from mobile.
