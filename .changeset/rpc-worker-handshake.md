---
"@kilocode/cli": patch
---

Hold RPC requests until the worker announces its handler, so a request raised while the worker is still evaluating its module graph is answered instead of dropped, and the caller no longer hangs forever.
