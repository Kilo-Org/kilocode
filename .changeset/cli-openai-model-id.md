---
"@kilocode/cli": patch
---

Add Model ID field to OpenAI Compatible provider in CLI settings

Fixes #5236. The OpenAI Compatible provider was missing a Model ID input field in the CLI setup wizard, preventing users from specifying custom models when using VLLM or other OpenAI-compatible endpoints.

Changes:

- Added `openAiModelId` to required fields in `validation.ts`
- Added Model ID field metadata in `FIELD_REGISTRY` in `settings.ts`
- Added Model ID input field to the OpenAI Compatible provider settings UI
