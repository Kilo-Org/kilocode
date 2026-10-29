---
"kilo-code": patch
---

Fix the Indexing settings tab to display managed/enterprise config values, which previously rendered blank. Managed fields are now tagged, overlay-resolved values are shown when the user scope is empty, and the tab recomputes each field's editability from the overlay `source` plus the active scope — so managed values are locked (shown, disabled) in the global view but remain overridable via project config, matching the config overlay endpoint even though the snapshot is fetched at project scope. The enable switch now resolves through the overlay so its on/off and locked state stay consistent with its managed tag.
