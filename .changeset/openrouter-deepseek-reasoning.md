---
"@kilocode/cli": patch
"@kilocode/kilo-gateway": patch
---

Fix multi-turn DeepSeek reasoning round-tripping on OpenRouter by bumping `@openrouter/ai-sdk-provider` to 2.8.1 in both the CLI and Kilo Gateway packages and letting the SDK handle reasoning details, plus pulling in upstream DeepSeek variant, reasoning-effort, and assistant-reasoning fixes. New DeepSeek conversations are fixed; existing sessions that already stored empty reasoning metadata may still need to be restarted.
