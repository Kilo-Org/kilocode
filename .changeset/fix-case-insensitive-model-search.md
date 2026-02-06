---
"webview-ui": patch
---

Fix case-insensitive model search in ModelPicker

Users can now search for models regardless of casing. For example, searching for "kimi k2.5" will find models like "Kimi-K2.5-Instruct". This fixes model discovery issues when using Azure Cognitive Services or other OpenAI-compatible providers that return models with different casing.

Before: Search was case-sensitive, making it hard to find models
After: Search is case-insensitive for better discoverability
