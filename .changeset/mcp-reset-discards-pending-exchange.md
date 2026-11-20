---
"@kilocode/cli": patch
"@kilocode/kilo-jetbrains": patch
---

Discard the credentials of a sign-in that is reset or cancelled while its token exchange is already running, so a cleared sign-in stays cleared. The JetBrains plugin releases an active sign-in before it clears the stored credential.
