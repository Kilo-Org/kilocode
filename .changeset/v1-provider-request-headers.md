---
"@kilocode/cli": patch
"kilo-code": patch
---

Carry configured provider headers and bearer tokens as request headers when a configuration document is converted to the newer format, so a configured `headers` entry and an `authToken` apply to the provider request.
