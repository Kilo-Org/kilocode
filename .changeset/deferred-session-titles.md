---
"@kilocode/cli": patch
"kilo-code": patch
---

Generate chat session titles after a turn provides enough context instead of from the first message alone. A short first message now keeps the placeholder title until the session has a longer request, a second message, or real tool work, so titles describe the actual task rather than a bare URL or a truncated first line.
