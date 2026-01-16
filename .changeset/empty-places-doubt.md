---
"kilo-code": patch
---

Supports AI Attribution and code formatters format on save. Previously, the AI attribution service would not account for the fact that after saving, the AI generated code would completely change based on the user's configured formatter. This change fixes the issue by using the formatted result for attribution.
