---
"@kilocode/cli": patch
---

`dangerously_disable_file_safety_guards`: Disable built-in safety guards for sensitive file reads and Kilo config edits so normal permission rules and approvals apply. Only trusted global config may enable this option. This covers `.env` reads and Kilo config edits.
