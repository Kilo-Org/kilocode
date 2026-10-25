---
"kilo-code": patch
---

Fix the Indexing settings tab to display managed/enterprise config values, which previously rendered blank. Managed fields are now tagged, inputs that cannot be saved are disabled, and overlay-resolved values are shown when the user scope is empty. A locked (non-editable) managed value now wins over a same-named value in the global or project scope, so a managed field renders its effective value as disabled instead of a stale value that would be rejected on save.
