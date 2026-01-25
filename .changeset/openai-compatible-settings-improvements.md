---
"kilo-code": minor
---

Add reasoning and capability controls for OpenAI Compatible models

- Added checkboxes for 'Supports Reasoning', 'Supports Function Calling', and 'Supports Computer Use' to the OpenAI Compatible settings UI.
- Compacted the capability checkboxes into a 2-column grid layout with tooltip-only descriptions.
- Updated OpenAiHandler to inject the 'thinking' parameter when reasoning is enabled and the model supports it.
- Gated tool inclusion based on the 'supportsNativeTools' flag.
