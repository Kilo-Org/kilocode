---
"@kilocode/kilo-jetbrains": patch
---

Keep the current account visible when the details cannot be loaded right after signing in or switching organization, and show a notice with a Refresh action that retries. The notice stays available while the details are still unavailable, and a read that brings the account clears it. A switch made from the session account switcher reports the same outcome with an action that opens the account settings.