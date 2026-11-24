---
"kilo-code": patch
"@kilocode/kilo-jetbrains": patch
---

Keep OpenAI and Gateway model selections distinct. In JetBrains, show the correct provider in the picker and restore it when reopening a chat. In VS Code, block sends when the selected external model is unavailable instead of switching to Kilo Gateway.
