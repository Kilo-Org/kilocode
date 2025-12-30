---
"kilo-code": patch
---

Fix terminal scroll-flicker in CLI by disabling streaming output and enabling Ink incremental rendering

- Hide partial (streaming) messages from the UI and render only completed messages via Ink's `<Static>` component
- Enable `incrementalRendering` option in Ink to reduce minor flicker during UI updates
- Messages now appear only once complete instead of streaming character-by-character
