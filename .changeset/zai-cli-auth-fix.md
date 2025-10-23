---
"@kilocode/cli": patch
---

Fix ZAI CLI authentication by collecting all required provider fields

Updated the CLI authentication wizard to properly collect ZAI provider configuration:
- API token (zaiApiKey)
- API line selection (zaiApiLine): international_coding vs china_coding
- Model selection (apiModelId): glm-4.6, glm-4.5, etc.

Resolves authentication errors: "zaiApiLine is required" and "apiModelId is required"