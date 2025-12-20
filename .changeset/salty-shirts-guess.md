---
"kilo-code": patch
---

Fix Agent Manager not showing error when CLI is misconfigured. When the CLI exits with a configuration error (e.g., missing kilocodeToken), the extension now detects this and shows an error popup with options to run `kilocode auth` or `kilocode config`.
