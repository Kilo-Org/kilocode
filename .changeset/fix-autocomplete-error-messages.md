---
"kilo-code": patch
---

Improve autocomplete error messages to clarify BYOK and credits issues

When autocomplete is paused due to a payment or auth error, the messages now explain all possible causes: no Kilo credits, API key (BYOK) quota exhausted, not signed in, or invalid/missing API key.
