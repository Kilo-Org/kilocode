---
"@kilocode/kilo-jetbrains": patch
---

Use the configured API key environment variable (or an already-saved key) when selecting models for a custom OpenAI-compatible provider, instead of requiring the key to be retyped every time. Also allow removing custom providers that authenticate through an environment variable, and stop a cleared environment variable from lingering in the saved configuration.
