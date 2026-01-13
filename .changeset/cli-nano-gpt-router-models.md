---
"@kilocode/cli": patch
---

Fix CLI `/model list` returning "No models available" for nano-gpt provider

- Add nano-gpt to RouterName type and PROVIDER_TO_ROUTER_NAME mapping
- Add nano-gpt to needsRouterModels list in ensureRouterModels()
- Add getModelIdKey() case for nano-gpt returning "nanoGptModelId"

Fixes #4689
