---
"@kilocode/cli": patch
---

Task tool: a bare model name in `subagent_model` or an agent `model` now resolves to the matching provider model instead of failing with a "Model not found" error or being ignored. The parent session's provider is preferred when several providers offer a model with the same name.
