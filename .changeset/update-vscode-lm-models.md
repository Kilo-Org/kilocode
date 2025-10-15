---
"kilo-code": patch
---

Update VS Code Language Model API provider metadata to reflect current model limits:

- Align context windows, prompt/input limits, and max output tokens with the latest provider data for matching models: gpt-3.5-turbo, gpt-4o-mini, gpt-4, gpt-4-0125-preview, gpt-4o, o3-mini, claude-3.5-sonnet, claude-sonnet-4, gemini-2.0-flash-001, gemini-2.5-pro, o4-mini-2025-04-16, gpt-4.1, gpt-5-mini, gpt-5.
- Fixes an issue where a default 128k context was assumed for all models.
- Notable: GPT-5 family now uses 264k context; o3-mini/o4-mini, Gemini, Claude, and 4o families have updated output and image support flags. GPT-5-mini max output explicitly set to 127,805.

This ensures Kilo Code correctly enforces model token budgets with the VS Code LM integration.
