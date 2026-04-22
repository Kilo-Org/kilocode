---
"@opencode-ai/ui": patch
"kilo-code": patch
---

Remove the JS timer from the TextShimmer component. The shimmer animation is now fully CSS-driven, eliminating a setTimeout/clearTimeout pair on every active-prop change. Keeps Kilo's chat view smoother while the model streams a reply, especially in sessions with many active tool calls.
