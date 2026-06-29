---
"@kilocode/cli": patch
---

Carry agent `displayName` and `source` as typed fields instead of storing them in the provider-options bag, so organization and marketplace agent metadata is never sent to the model API.
