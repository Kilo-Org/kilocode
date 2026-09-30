---
"@kilocode/cli": patch
---

Stop Claude Sonnet and Opus responses from ending early with "Response reached its output limit" during long reasoning. Claude requests now use the model's full output limit (128K on Claude 4.6 and newer) instead of 32K.
