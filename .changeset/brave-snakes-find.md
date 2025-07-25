---
"kilo-code": minor
"@roo-code/types": patch
---

Introduce a new Virtual Quota Fallback Provider - delegate to other Profiles based on cost or request count limits!

This new virtual provider lets you set cost- or request-based quotas for a list of profiles. It will automatically falls back to the next profile's provider when any limit is reached!
