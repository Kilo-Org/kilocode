---
"kilo-code": patch
---

Fix repeated "autocomplete paused" notification when Inception next-edit is configured and the user is not logged in. The notification now fires at most once per fatal episode, and all subsequent requests are silently blocked until the user re-authenticates or adds credits.
