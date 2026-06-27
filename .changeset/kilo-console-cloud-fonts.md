---
"@kilocode/kilo-web-ui": patch
---

Use the same font stack as Kilo Cloud (Inter variable for sans, Roboto Mono variable for mono, JetBrains Mono variable as the alt-mono token) in Kilo Console. Fonts are now self-hosted as woff2 in `@kilocode/kilo-web-ui`, so Inter no longer relies on the OS having it installed.