---
"kilo-code": patch
---

Fix recurring MODEL_NO_TOOLS_USED error loop by detecting text-based tool call hallucinations and instructing the model to use the native API.
