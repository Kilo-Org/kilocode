---
"kilo-code": minor
---

Support a custom speech-to-text source. Point voice input at any OpenAI-compatible transcription API with a base URL and optional API key, instead of always using Kilo Gateway. Switching back to Kilo Gateway restores a valid Gateway transcription model instead of showing the custom one, and a custom endpoint requires its own model ID. Custom transcription settings are read from the global config only, so a workspace config cannot redirect voice input.
