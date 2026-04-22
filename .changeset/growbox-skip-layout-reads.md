---
"@kilocode/kilo-ui": patch
"kilo-code": patch
---

Reduce layout reads while the model streams a reply. The GrowBox component that wraps the currently-streaming message no longer forces a synchronous layout on every ResizeObserver firing — it reuses the browser's pre-measured content size and skips sub-pixel height updates.
