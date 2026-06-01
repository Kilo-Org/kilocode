---
"@kilocode/cli": patch
---

Fix Claude Opus 4.8 reasoning on Amazon Bedrock by treating it as an adaptive thinking model like Opus 4.7. This resolves the "thinking.type.enabled is not supported for this model" error and exposes the full low/medium/high/xhigh/max reasoning effort range.
