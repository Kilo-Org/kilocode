---
"kilo-code": patch
---

Fix repeated "autocomplete paused" notification when Inception next-edit is configured and the user is not logged in. Next-edit autocomplete now pauses after the first fatal error (notifying once), resumes when the user logs back in, and self-heals from depleted credits via a periodic balance check — matching the classic autocomplete behavior.
