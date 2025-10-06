---
"kilo-code": minor
---

Removed the option to use custom provider for autocomplete.

Using a custom provider defaults to using a your globally configured provider without any context-window cap, and using a custom provider with no further restrictions like that means that per-autocomplete request costs are sometimes extremely high and responses very slow.
