---
"kilo-code": minor
---

Render attached and tool-returned images inline in the Kilo CLI. Images draw only in terminals that support a real graphics protocol (kitty, Ghostty, WezTerm, or sixel); other terminals, including the VS Code integrated terminal without image support, show a text placeholder instead of a low-fidelity fallback. Set `KILO_IMAGE_PROTOCOL=kitty|sixel|blocks` to override detection.
