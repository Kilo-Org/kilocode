---
"@kilocode/kilo-jetbrains": patch
---

Fix the JetBrains plugin blocking IntelliJ's dynamic unload on update, disable, and uninstall. Bundled HTTP client daemon threads no longer pin the plugin classloader, so the plugin unloads cleanly instead of leaking its classloader (and growing memory) across reloads.
