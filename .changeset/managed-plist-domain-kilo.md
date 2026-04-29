---
"@kilocode/cli": patch
---

Rename macOS MDM-managed plist domain from `ai.opencode.managed` to `ai.kilo.managed`. Admins deploying `.mobileconfig` profiles must update the profile domain to `ai.kilo.managed` and rename the plist to `ai.kilo.managed.plist`.
