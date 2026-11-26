---
"@kilocode/cli": patch
"kilo-code": patch
"@kilocode/kilo-jetbrains": patch
---

Show a clear "signed out" message with a sign-in action when Kilo rejects your login, instead of a generic error. The CLI points to `/connect` and `kilo auth login`. In VS Code, the Sign in button starts login in the Kilo Profile tab. JetBrains opens User Profile and resends your message once you are signed in again.
