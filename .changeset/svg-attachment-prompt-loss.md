---
"@kilocode/cli": patch
"@kilocode/kilo-jetbrains": patch
---

Fix SVG and other non-raster image attachments failing the whole prompt instead of being read as source. Fix a rejected or failed send losing the typed message with no way to recover it, and add a Dismiss action to standalone error cards that have no transcript tail to retry.
